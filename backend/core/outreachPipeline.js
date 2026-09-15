const { v4: uuid } = require('uuid');
const memory = require('../memory');
const config = require('../config');
const activityLog = require('./activityLog');
const { selectProvider } = require('./router');
const { businessContextLine } = require('./businessContext');
// NOTE: agents/registry (and, transitively, core/orchestrator, which also
// requires agents/registry at its own top level) are required lazily
// (inside functions below), not at the top of this file. registry.js
// requires ResponseDetectionAgent, which requires this file - a real
// circular require. Requiring registry.js (or anything that itself
// requires registry.js at load time) up here would capture an exports
// object before registry.js finishes executing (its
// `module.exports = {...}` reassignment hasn't run yet at that point),
// silently getting an empty object and breaking getAgent(). Requiring
// lazily instead defers evaluation until after the app has fully started,
// by which point the cycle has already resolved.

/**
 * outreachPipeline.js - Phase 2: Outreach + Approval Modes.
 *
 * Wires JobVerificationAgent (Phase 1) into gated, personalized outreach.
 * Nothing here ever sends an email directly - every send goes through the
 * SAME approval-gated path (BaseAgent.createApprovalTask + the existing
 * orchestrator.approveTask) that every other irreversible action in this
 * codebase already uses. Automatic mode does not bypass that gate; it
 * auto-triggers the *same* legitimate approval flow a human would use, only
 * when strict conditions are met, and only when explicitly enabled - never
 * by calling the tool directly.
 *
 * Pipeline stages (matches spec section 8):
 *   discovered -> verification -> verified -> contact_found ->
 *   outreach_drafted -> awaiting_approval -> sent
 * with terminal rejection stages: rejected_verification, rejected_contact.
 */

const STAGES = {
  DISCOVERED: 'discovered',
  VERIFICATION: 'verification',
  VERIFIED: 'verified',
  CONTACT_FOUND: 'contact_found',
  OUTREACH_DRAFTED: 'outreach_drafted',
  AWAITING_APPROVAL: 'awaiting_approval',
  SENT: 'sent',
  RESPONSE_RECEIVED: 'response_received',
  CALL_REQUESTED: 'call_requested',
  CALL_SCHEDULED: 'call_scheduled',
  REJECTED_VERIFICATION: 'rejected_verification',
  REJECTED_CONTACT: 'rejected_contact',
};

const MODES = {
  MANUAL: 'manual',
  SEMI_AUTOMATIC: 'semi_automatic',
  AUTOMATIC: 'automatic',
};

/**
 * Drafts a short, personalized outreach email using ONLY verified fields
 * from the opportunity/verification record. Never claims something the
 * verification step didn't actually confirm - e.g. won't say "I saw you're
 * hiring for X" unless the job listing itself was verified.
 */
async function draftOutreach(opportunity, verification) {
  const verifiedFacts = [
    `Company: ${opportunity.company}`,
    `Job title: ${opportunity.jobTitle}`,
    verification.applicationUrlVerified ? `Application URL (verified): ${opportunity.applicationUrl}` : null,
    opportunity.location ? `Location: ${opportunity.location}` : null,
  ].filter(Boolean).join('\n');

  const provider = selectProvider({});
  const result = await provider.complete({
    system:
      `${businessContextLine()}You are drafting a short, genuinely personalized job outreach email. ` +
      'Keep it under 120 words, no hard sell, no generic filler. ONLY reference facts listed below as ' +
      'verified - never claim anything about the job/company that is not explicitly given. ' +
      'Respond with ONLY a JSON object: {"subject": "...", "body": "..."}',
    prompt: `Verified facts:\n${verifiedFacts}`,
    maxTokens: 500,
  });

  try {
    const match = result.text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : null;
    if (parsed && parsed.subject && parsed.body) return parsed;
  } catch {
    // fall through to error below
  }
  throw new Error('Outreach drafting did not return valid subject/body JSON');
}

// Maps our pipeline stages onto the tasks table's actual `status` column
// vocabulary (pending | pending_approval | done | failed | rejected) - the
// real schema has no `stage` column, so the fine-grained stage lives inside
// `payload` (jsonb) instead, and this is just the coarse top-level status.
function statusForStage(stage) {
  if (stage === STAGES.AWAITING_APPROVAL) return 'pending_approval';
  if (stage === STAGES.SENT || stage === STAGES.RESPONSE_RECEIVED || stage === STAGES.CALL_REQUESTED || stage === STAGES.CALL_SCHEDULED) return 'done';
  if (stage === STAGES.REJECTED_VERIFICATION || stage === STAGES.REJECTED_CONTACT) return 'rejected';
  return 'pending';
}

/**
 * Persists the current pipeline state and returns a flattened, convenient
 * shape for callers (stage/draft/verification etc. at the top level)
 * regardless of how the underlying store represents it. All the
 * pipeline-specific fields live inside `payload` - the one column the real
 * schema actually supports for arbitrary JSON - never as invented top-level
 * columns the tasks table doesn't have.
 */
async function persist(pipelineId, state, { isNew = false } = {}) {
  const task = {
    id: pipelineId,
    agent: 'outreach-pipeline',
    instruction: `Job outreach pipeline: ${state.opportunity.jobTitle || 'unknown role'} at ${state.opportunity.company || 'unknown company'}`,
    status: statusForStage(state.stage),
    irreversible: false,
    payload: state,
    created_at: new Date().toISOString(),
  };
  const saved = isNew ? await memory.saveTask(task) : await memory.updateTask(pipelineId, { status: task.status, payload: state });
  await activityLog.record('Outreach Pipeline', 'stage_changed', state.opportunity.company || '', { pipelineId, stage: state.stage });
  return { id: pipelineId, ...(saved && saved.payload ? saved.payload : state) };
}

/**
 * Runs a single raw opportunity through the full verification + outreach
 * pipeline. Returns a flattened pipeline record (also persisted via
 * memory.saveTask/updateTask, with the pipeline-specific fields nested in
 * the `payload` column so it fits the real tasks table schema).
 *
 * @param {object} opportunity - raw opportunity, same shape JobVerificationAgent expects
 * @param {object} [options]
 * @param {string} [options.mode] - overrides config.outreach.mode for this run
 */
async function processOpportunity(opportunity, options = {}) {
  const mode = options.mode || config.outreach.mode;
  if (!Object.values(MODES).includes(mode)) {
    throw new Error(`Unknown outreach mode: "${mode}". Must be one of: ${Object.values(MODES).join(', ')}`);
  }

  // Always a fresh, real UUID - the tasks table's id column is a genuine
  // uuid type, so we can't reuse an opportunity's own id/slug (e.g. a job
  // board's "indeed-12345") even if the caller supplied one. The caller's
  // own id, if any, is preserved inside opportunity itself, untouched.
  const pipelineId = uuid();

  let state = {
    pipelineType: 'job_outreach_pipeline',
    stage: STAGES.DISCOVERED,
    mode,
    opportunity,
  };
  let record = await persist(pipelineId, state, { isNew: true });

  // --- Verification (Phase 1) ---
  state = { ...state, stage: STAGES.VERIFICATION };
  record = await persist(pipelineId, state);

  const { getAgent } = require('../agents/registry');
  const jobVerificationAgent = getAgent('job-verification');
  const verification = await jobVerificationAgent.verify({ ...opportunity, id: pipelineId });

  const meetsThreshold = verification.score >= config.outreach.verificationThreshold;
  const statusAllowed =
    verification.status === 'VERIFIED' || (verification.status === 'LIKELY_CURRENT' && config.outreach.allowLikelyCurrent);

  if (!statusAllowed || !meetsThreshold) {
    state = { ...state, stage: STAGES.REJECTED_VERIFICATION, verification };
    record = await persist(pipelineId, state);
    return record;
  }

  state = { ...state, stage: STAGES.VERIFIED, verification };
  record = await persist(pipelineId, state);

  // Manual mode stops here - verification only, nothing drafted or sent
  // until the person manually triggers the next step themselves.
  if (mode === MODES.MANUAL) {
    return record;
  }

  // --- Contact check ---
  if (verification.contactStatus !== 'VERIFIED' && verification.contactStatus !== 'LIKELY_VALID') {
    state = { ...state, stage: STAGES.REJECTED_CONTACT };
    record = await persist(pipelineId, state);
    return record;
  }

  state = { ...state, stage: STAGES.CONTACT_FOUND };
  record = await persist(pipelineId, state);

  // --- Draft outreach (semi_automatic and automatic both draft; manual already returned above) ---
  const draft = await draftOutreach(opportunity, verification);
  state = { ...state, stage: STAGES.OUTREACH_DRAFTED, draft };
  record = await persist(pipelineId, state);

  // --- Create the approval-gated send task (same mechanism every other
  // irreversible action in this codebase uses) ---
  const salesAgent = require('../agents/registry').getAgent('sales');
  const approvalTask = await salesAgent.createApprovalTask({
    instruction: `Send verified job outreach email to ${opportunity.contactEmail} re: ${opportunity.jobTitle} at ${opportunity.company}`,
    tool: 'gmail.sendEmail',
    payload: { to: opportunity.contactEmail, subject: draft.subject, body: draft.body },
  });

  state = { ...state, stage: STAGES.AWAITING_APPROVAL, approvalTaskId: approvalTask.id };
  record = await persist(pipelineId, state);

  if (mode === MODES.SEMI_AUTOMATIC) {
    // Stops here - a human must explicitly approve via the existing
    // approval flow before anything sends.
    return record;
  }

  // --- Automatic mode: only auto-approves if EVERY condition is met ---
  if (mode === MODES.AUTOMATIC) {
    const autoApprovalCheck = await checkAutoApprovalEligible(verification);

    if (!config.outreach.automaticEnabled) {
      await activityLog.record('Outreach Pipeline', 'auto_send_blocked', opportunity.company || '', {
        pipelineId,
        reason: 'Automatic mode requested but OUTREACH_AUTOMATIC_ENABLED is not set - awaiting manual approval instead',
      });
      return record;
    }

    if (!autoApprovalCheck.eligible) {
      await activityLog.record('Outreach Pipeline', 'auto_send_blocked', opportunity.company || '', {
        pipelineId,
        reason: autoApprovalCheck.reason,
      });
      return record;
    }

    // Log the automatic decision explicitly and honestly BEFORE executing,
    // then run it through the exact same approveTask() path a human click
    // would take - not a shortcut around the tool registry's irreversible
    // gate, just an automated trigger of the same legitimate path.
    await activityLog.record('Outreach Pipeline', 'auto_approved', opportunity.company || '', {
      pipelineId,
      approvalTaskId: approvalTask.id,
      score: verification.score,
      reason: 'All automatic-send conditions met',
    });

    const sentTask = await require('./orchestrator').approveTask(approvalTask.id);
    state = {
      ...state,
      stage: sentTask.status === 'done' ? STAGES.SENT : STAGES.AWAITING_APPROVAL,
      sendResult: sentTask.result,
      ...(sentTask.status === 'done' ? { sentAt: new Date().toISOString() } : {}),
    };
    record = await persist(pipelineId, state);
  }

  return record;
}

/**
 * Called after a human approves a pending outreach send from the Tasks page
 * (i.e. NOT through automatic mode above, which records sentAt itself).
 * Keeps the pipeline's `sentAt`/`stage` in sync so follow-up scheduling and
 * response detection both know when the clock actually started. A manual
 * approval happens through the generic approveTask() flow (triggered by the
 * Tasks page's approve button, not this pipeline module), so this needs to
 * be called explicitly once that approval task's status is known to be
 * 'done' - otherwise the pipeline would look stuck at AWAITING_APPROVAL
 * forever even though the email actually went out.
 *
 * @param {string} pipelineId
 * @param {object} sendResult - the approved task's result
 */
async function markSent(pipelineId, sendResult) {
  const task = await memory.getTask(pipelineId);
  if (!task || !task.payload) return null;
  const state = { ...task.payload, stage: STAGES.SENT, sendResult, sentAt: new Date().toISOString() };
  return persist(pipelineId, state);
}

/**
 * Every condition from spec section 7 (Automatic mode) checked explicitly,
 * plus the daily send limit from section 22's user controls. Returns which
 * condition failed, if any, so the activity log is honest about why
 * something wasn't auto-sent rather than just silently not sending.
 */
async function checkAutoApprovalEligible(verification) {
  if (verification.status !== 'VERIFIED') {
    return { eligible: false, reason: `Opportunity status is ${verification.status}, not VERIFIED` };
  }
  if (verification.contactStatus !== 'VERIFIED') {
    return { eligible: false, reason: `Contact status is ${verification.contactStatus}, not VERIFIED` };
  }
  if (verification.score < config.outreach.verificationThreshold) {
    return { eligible: false, reason: `Score ${verification.score} is below threshold ${config.outreach.verificationThreshold}` };
  }
  if (verification.reasons.some((r) => /suspicious|could not confirm|could not verify/i.test(r))) {
    return { eligible: false, reason: 'Verification reasons include unresolved suspicious signals' };
  }

  const allTasks = await memory.listTasks();
  const today = new Date().toISOString().slice(0, 10);
  const sentToday = allTasks.filter(
    (t) =>
      t.payload &&
      t.payload.pipelineType === 'job_outreach_pipeline' &&
      t.payload.stage === STAGES.SENT &&
      (t.updated_at || '').slice(0, 10) === today
  ).length;
  if (sentToday >= config.outreach.dailySendLimit) {
    return { eligible: false, reason: `Daily outreach send limit (${config.outreach.dailySendLimit}) already reached` };
  }

  return { eligible: true, reason: null };
}

/**
 * Called by ResponseDetectionAgent when an inbound email matches a sent
 * outreach pipeline. A genuine response stops the follow-up sequence
 * immediately (per spec section 13). An "Automated response" classification
 * (out-of-office, autoresponder) deliberately does NOT stop the sequence or
 * mark the pipeline as responded-to - an autoresponder isn't the contact
 * actually replying, so treating it as a real response would silently kill
 * legitimate follow-ups over something that isn't really an answer.
 *
 * @param {string} pipelineId
 * @param {object} response - { classification, schedulingRequestDetected, snippet, from, receivedAt, messageId }
 */
async function recordResponse(pipelineId, response) {
  const task = await memory.getTask(pipelineId);
  if (!task || !task.payload) return null;

  const respondedMessageIds = new Set(task.payload.respondedMessageIds || []);
  if (response.messageId) respondedMessageIds.add(response.messageId);

  const isAutomated = response.classification === 'Automated response';
  const state = {
    ...task.payload,
    respondedMessageIds: [...respondedMessageIds],
    responses: [...(task.payload.responses || []), response],
    ...(isAutomated
      ? {}
      : {
          stage: STAGES.RESPONSE_RECEIVED,
          latestResponseClassification: response.classification,
        }),
  };

  return persist(pipelineId, state);
}

/**
 * Runs the Day 4 / Day 10 / Day 21 (configurable) follow-up sequence over
 * every pipeline that's SENT and hasn't gotten a genuine response yet.
 * Drafts and creates an approval-gated send for whichever follow-up is next
 * due - never sends directly, same gate as the original outreach. Intended
 * to be called on a schedule (e.g. daily), same pattern as the existing
 * Gmail-triage scheduler.
 *
 * Stop conditions (matches spec section 13):
 *   - a genuine response was received (stage moved to RESPONSE_RECEIVED)
 *   - every configured follow-up has already been sent
 *   - not yet due (days since sent hasn't reached the next threshold)
 */
async function checkFollowUps() {
  const followUpDays = config.outreach.followUpDays.slice(0, config.outreach.maxFollowUps);
  const allTasks = await memory.listTasks();
  const eligible = allTasks.filter(
    (t) => t.payload && t.payload.pipelineType === 'job_outreach_pipeline' && t.payload.stage === STAGES.SENT && t.payload.sentAt
  );

  const results = [];
  for (const task of eligible) {
    const state = task.payload;
    const daysSinceSent = Math.floor((Date.now() - new Date(state.sentAt).getTime()) / (1000 * 60 * 60 * 24));
    const followUpsSent = state.followUpsSent || [];
    const nextIndex = followUpsSent.length;

    if (nextIndex >= followUpDays.length) continue; // sequence exhausted
    if (daysSinceSent < followUpDays[nextIndex]) continue; // not due yet

    const draft = await draftFollowUp(state.opportunity, state.verification, nextIndex + 1);
    const salesAgent = require('../agents/registry').getAgent('sales');
    const approvalTask = await salesAgent.createApprovalTask({
      instruction: `Follow-up #${nextIndex + 1} to ${state.opportunity.contactEmail} re: ${state.opportunity.jobTitle} at ${state.opportunity.company}`,
      tool: 'gmail.sendEmail',
      payload: { to: state.opportunity.contactEmail, subject: draft.subject, body: draft.body },
    });

    const newState = {
      ...state,
      followUpsSent: [...followUpsSent, { index: nextIndex + 1, day: followUpDays[nextIndex], queuedAt: new Date().toISOString(), approvalTaskId: approvalTask.id }],
    };
    await persist(task.id, newState);
    await activityLog.record('Outreach Pipeline', 'follow_up_queued', state.opportunity.company || '', {
      pipelineId: task.id,
      followUpIndex: nextIndex + 1,
      approvalTaskId: approvalTask.id,
    });
    results.push({ pipelineId: task.id, followUpIndex: nextIndex + 1, approvalTaskId: approvalTask.id });
  }

  return { checked: eligible.length, queued: results.length, results };
}

/**
 * Short, low-pressure follow-up draft - explicitly NOT a repeat of the
 * original pitch. Same "only verified facts" discipline as draftOutreach.
 */
async function draftFollowUp(opportunity, verification, followUpNumber) {
  const verifiedFacts = [
    `Company: ${opportunity.company}`,
    `Job title: ${opportunity.jobTitle}`,
    verification?.applicationUrlVerified ? `Application URL (verified): ${opportunity.applicationUrl}` : null,
  ].filter(Boolean).join('\n');

  const provider = selectProvider({});
  const result = await provider.complete({
    system:
      `${businessContextLine()}You are drafting follow-up #${followUpNumber} to a job outreach email that got no response. ` +
      'Keep it VERY short (under 60 words), friendly, low-pressure - a gentle bump, not a repeat of the original pitch. ' +
      'ONLY reference facts listed below as verified. ' +
      'Respond with ONLY a JSON object: {"subject": "...", "body": "..."}',
    prompt: `Verified facts:\n${verifiedFacts}`,
    maxTokens: 300,
  });

  try {
    const match = result.text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : null;
    if (parsed && parsed.subject && parsed.body) return parsed;
  } catch {
    // fall through to error below
  }
  throw new Error('Follow-up drafting did not return valid subject/body JSON');
}

/**
 * Generic state patch for other modules (SchedulingAgent, etc.) that need
 * to update a pipeline without duplicating the persist()/schema-mapping
 * logic here. Always merges onto the CURRENT stored state (read-modify-
 * write), never a blind overwrite, so a caller only needs to pass the
 * fields it actually wants to change.
 *
 * @param {string} pipelineId
 * @param {object} patch - fields to merge into the existing payload
 */
async function updateState(pipelineId, patch) {
  const task = await memory.getTask(pipelineId);
  if (!task || !task.payload) return null;
  const state = { ...task.payload, ...patch };
  return persist(pipelineId, state);
}

module.exports = {
  processOpportunity,
  draftOutreach,
  draftFollowUp,
  checkAutoApprovalEligible,
  recordResponse,
  checkFollowUps,
  markSent,
  updateState,
  STAGES,
  MODES,
};