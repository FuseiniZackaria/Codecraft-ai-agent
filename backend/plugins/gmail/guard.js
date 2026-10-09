/**
 * guard.js - centralized safety guard for every Gmail SEND path.
 *
 * Design goals:
 *  - Nothing is sent to another person without an approval trail. Either:
 *      (a) `sendContext.approvedTaskId` points to a real task that was
 *          dispatched through orchestrator.approveTask (human click or
 *          outreachPipeline's auto-approve path, which itself goes through
 *          approveTask), OR
 *      (b) the request is an explicit internal self-notification to the
 *          configured applicant/owner (`systemDigest: true`, `to` must equal
 *          `config.applicant.email` exactly).
 *  - A replyToThread call to a thread registered in `outreach_threads` is
 *    only permitted when the task's agent matches the thread's owning agent
 *    and the recipient matches the registered recipient. This prevents a
 *    stray PA draft from reaching a sales lead's reply.
 *  - Duplicate suppression: the same (to, subject, body-fingerprint) within
 *    DEDUP_WINDOW_MS, or the same reply body to the same thread within the
 *    same window, is rejected as a duplicate.
 *  - Every refusal is audited with a non-sensitive summary (actor, reason,
 *    recipient, subject). Bodies are hashed, never logged in full.
 *  - Secrets (OAuth tokens, API keys, passwords) are never read or logged
 *    here; the guard only looks at task metadata and recipient addresses.
 *
 * Returns an "ok" verdict on success. On refusal throws a GmailGuardError
 * whose message is a short structured string the caller can surface to the
 * UI without leaking internals.
 */

const crypto = require('crypto');
const memory = require('../../memory');
const config = require('../../config');

const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

class GmailGuardError extends Error {
  constructor(code, message, details = {}) {
    super(`[gmail-guard:${code}] ${message}`);
    this.name = 'GmailGuardError';
    this.code = code;
    this.details = details;
  }
}

function fingerprintBody(body) {
  return crypto.createHash('sha256').update(String(body || '')).digest('hex').slice(0, 16);
}

function normalizeEmail(addr) {
  return (addr || '').trim().toLowerCase();
}

async function audit(action, metadata) {
  try {
    await memory.audit('gmail-guard', action, metadata.target || '', metadata);
  } catch {
    // Audit log must never block a send decision. If the log fails we still
    // return the verdict - the guard's job is to decide, not to persist.
  }
}

/**
 * Core approval validation. Confirms there is a real pending/approved task
 * backing this send that targets THIS tool. Returns the task if valid,
 * throws otherwise.
 */
async function verifyApprovedTask(approvedTaskId, expectedTool) {
  if (!approvedTaskId) {
    throw new GmailGuardError('no_approval', 'No approvedTaskId was supplied - every send must flow through the approval gate.');
  }
  const task = await memory.getTask(approvedTaskId);
  if (!task) {
    throw new GmailGuardError('task_not_found', `Approval task ${approvedTaskId} does not exist.`, { approvedTaskId });
  }
  const toolOnTask = task.toolCall?.tool;
  if (toolOnTask && toolOnTask !== expectedTool) {
    throw new GmailGuardError('tool_mismatch', `Approval task is for ${toolOnTask}, not ${expectedTool}.`, {
      approvedTaskId,
      expected: expectedTool,
      actual: toolOnTask,
    });
  }
  // Status at the moment orchestrator.approveTask invokes the tool is still
  // 'pending_approval' (it transitions to 'done' only AFTER the tool
  // returns). 'done' is also accepted so idempotent retries that already
  // flipped status don't trip the guard.
  if (!['pending_approval', 'done'].includes(task.status)) {
    throw new GmailGuardError('wrong_status', `Approval task status is "${task.status}" - not an active approval.`, {
      approvedTaskId,
      status: task.status,
    });
  }
  return task;
}

/**
 * Looks at the audit_log for a near-identical recent send and refuses if one
 * exists. Scanned window is small (DEDUP_WINDOW_MS) to keep this cheap.
 */
async function checkDuplicateSend({ to, subject, bodyFp }) {
  try {
    const limit = 200;
    const audits = typeof memory.getAuditLog === 'function' ? await memory.getAuditLog(limit) : [];
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    const match = audits.find((row) => {
      if (!row || row.action !== 'send_ok') return false;
      const at = new Date(row.at || row.created_at || 0).getTime();
      if (!(at >= cutoff)) return false;
      const m = row.metadata || {};
      return m.to === to && m.subject === subject && m.bodyFp === bodyFp;
    });
    if (match) {
      throw new GmailGuardError('duplicate_send', 'An identical message was already sent within the last 10 minutes.', {
        to,
        subject,
        matchedAuditId: match.id,
      });
    }
  } catch (err) {
    if (err instanceof GmailGuardError) throw err;
    // audit_log read errors are not fatal - better to let a send proceed
    // than block legitimate traffic because the log is unreachable.
  }
}

async function checkDuplicateReply({ threadId, bodyFp }) {
  try {
    const limit = 200;
    const audits = typeof memory.getAuditLog === 'function' ? await memory.getAuditLog(limit) : [];
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    const match = audits.find((row) => {
      if (!row || row.action !== 'reply_ok') return false;
      const at = new Date(row.at || row.created_at || 0).getTime();
      if (!(at >= cutoff)) return false;
      const m = row.metadata || {};
      return m.threadId === threadId && m.bodyFp === bodyFp;
    });
    if (match) {
      throw new GmailGuardError('duplicate_reply', 'An identical reply was already sent to this thread within the last 10 minutes.', {
        threadId,
        matchedAuditId: match.id,
      });
    }
  } catch (err) {
    if (err instanceof GmailGuardError) throw err;
  }
}

/**
 * Guard for gmail.sendEmail. Returns { ok: true } on allow; throws on deny.
 *
 * sendContext shape:
 *   { approvedTaskId?, systemDigest?, role? }
 *   - approvedTaskId: the task that was approved and is dispatching this
 *   - systemDigest: boolean - owner self-notification path (restricted to
 *     config.applicant.email). Never trusted as a bypass for arbitrary
 *     recipients.
 *   - role: agent key, informational for the audit record only
 */
async function guardSend({ to, subject, body }, sendContext = {}) {
  const normalizedTo = normalizeEmail(to);
  if (!normalizedTo) {
    throw new GmailGuardError('missing_recipient', 'Recipient address is missing or invalid.');
  }
  const bodyFp = fingerprintBody(body);
  const ctx = sendContext || {};

  // --- Internal owner-digest path. Must be addressed only to the owner. ---
  if (ctx.systemDigest) {
    const ownerEmail = normalizeEmail(config.applicant?.email);
    if (!ownerEmail) {
      throw new GmailGuardError('owner_not_configured', 'systemDigest requires APPLICANT_EMAIL to be configured.');
    }
    if (normalizedTo !== ownerEmail) {
      await audit('send_refused', {
        reason: 'systemDigest_recipient_mismatch',
        to: normalizedTo,
        subject,
        role: ctx.role || null,
      });
      throw new GmailGuardError('systemDigest_recipient_mismatch',
        `systemDigest sends are limited to the owner address; refused send to ${normalizedTo}.`,
        { to: normalizedTo, ownerEmail });
    }
    await checkDuplicateSend({ to: normalizedTo, subject, bodyFp });
    await audit('send_ok', { kind: 'systemDigest', to: normalizedTo, subject, bodyFp, role: ctx.role || null });
    return { ok: true, kind: 'systemDigest' };
  }

  // --- Standard approval-gated path. ---
  const task = await verifyApprovedTask(ctx.approvedTaskId, 'gmail.sendEmail');

  // Payload sanity: the approved task's own payload "to" field should match
  // the recipient actually being sent to. Otherwise someone could approve a
  // send to Alice and the tool be invoked for Bob.
  const taskTo = normalizeEmail(task.payload?.to);
  if (taskTo && taskTo !== normalizedTo) {
    await audit('send_refused', {
      reason: 'recipient_tampered',
      approvedTaskId: task.id,
      taskTo,
      callTo: normalizedTo,
      subject,
      role: ctx.role || task.agent || null,
    });
    throw new GmailGuardError('recipient_tampered',
      'Call recipient does not match the recipient on the approved task.',
      { approvedTaskId: task.id, approved: taskTo, attempted: normalizedTo });
  }

  await checkDuplicateSend({ to: normalizedTo, subject, bodyFp });
  await audit('send_ok', {
    approvedTaskId: task.id,
    role: ctx.role || task.agent || null,
    to: normalizedTo,
    subject,
    bodyFp,
  });
  return { ok: true, kind: 'approved_send', task };
}

/**
 * Guard for gmail.replyToThread. Returns { ok: true, outreachThread? } on
 * allow; throws on deny. Also returns the matched outreach_threads row so
 * the caller can update it (status/last_message_id) after the send succeeds.
 */
async function guardReply({ threadId, body, recipientEmail }, sendContext = {}) {
  if (!threadId) {
    throw new GmailGuardError('missing_thread', 'threadId is required.');
  }
  const normalizedTo = normalizeEmail(recipientEmail);
  if (!normalizedTo) {
    throw new GmailGuardError('missing_recipient', 'recipientEmail is required.');
  }

  const ctx = sendContext || {};
  const task = await verifyApprovedTask(ctx.approvedTaskId, 'gmail.replyToThread');

  const bodyFp = fingerprintBody(body);

  // --- Thread ownership check. If a row exists for this thread, the
  // calling task's agent must own that lane AND the recipient must match.
  let outreachThread = null;
  if (typeof memory.getOutreachThreadByThreadId === 'function') {
    outreachThread = await memory.getOutreachThreadByThreadId(threadId);
  }

  if (outreachThread) {
    const expectedAgent = outreachThread.agentKey;
    if (expectedAgent && task.agent && task.agent !== expectedAgent) {
      await audit('reply_refused', {
        reason: 'wrong_agent_for_thread',
        threadId,
        expectedAgent,
        actualAgent: task.agent,
        approvedTaskId: task.id,
      });
      throw new GmailGuardError('wrong_agent_for_thread',
        `Thread ${threadId} belongs to ${expectedAgent}; ${task.agent} is not permitted to reply.`,
        { threadId, expectedAgent, actualAgent: task.agent });
    }
    const expectedRecipient = normalizeEmail(outreachThread.recipientEmail);
    if (expectedRecipient && expectedRecipient !== normalizedTo) {
      await audit('reply_refused', {
        reason: 'thread_recipient_mismatch',
        threadId,
        expectedRecipient,
        actualRecipient: normalizedTo,
        approvedTaskId: task.id,
      });
      throw new GmailGuardError('thread_recipient_mismatch',
        'Reply recipient does not match the recipient registered for this thread.',
        { threadId, expected: expectedRecipient, attempted: normalizedTo });
    }
  }

  // --- Payload sanity: thread id and recipient must match what was approved.
  const taskThreadId = task.payload?.threadId;
  if (taskThreadId && taskThreadId !== threadId) {
    await audit('reply_refused', {
      reason: 'thread_tampered',
      approvedTaskId: task.id,
      taskThreadId,
      callThreadId: threadId,
    });
    throw new GmailGuardError('thread_tampered',
      'Call threadId does not match the approved task.',
      { approvedTaskId: task.id, approved: taskThreadId, attempted: threadId });
  }
  const taskRecipient = normalizeEmail(task.payload?.recipientEmail);
  if (taskRecipient && taskRecipient !== normalizedTo) {
    await audit('reply_refused', {
      reason: 'recipient_tampered',
      approvedTaskId: task.id,
      taskTo: taskRecipient,
      callTo: normalizedTo,
    });
    throw new GmailGuardError('recipient_tampered',
      'Call recipientEmail does not match the approved task.',
      { approvedTaskId: task.id, approved: taskRecipient, attempted: normalizedTo });
  }

  await checkDuplicateReply({ threadId, bodyFp });
  await audit('reply_ok', {
    approvedTaskId: task.id,
    role: ctx.role || task.agent || null,
    threadId,
    to: normalizedTo,
    bodyFp,
  });
  return { ok: true, kind: 'approved_reply', task, outreachThread };
}

/**
 * Called by the tool actions after Gmail returns a thread_id for an outreach
 * send, so the registry row records the real thread and status transitions
 * away from "draft". Safe when nothing is registered yet; a no-op in that
 * case. Looks for an existing row by approvedTaskId first (common case:
 * SalesAgent registered a draft row with the task id), falls back to
 * creating a fresh row keyed by thread_id when none exists.
 */
async function recordSentThread({ approvedTaskId, threadId, recipientEmail, messageId, agentKey, companyName, campaign }) {
  if (!threadId) return null;
  try {
    const normalizedTo = normalizeEmail(recipientEmail);
    let row = null;
    if (approvedTaskId && typeof memory.getOutreachThreadByApprovedTask === 'function') {
      row = await memory.getOutreachThreadByApprovedTask(approvedTaskId);
    }
    if (!row && typeof memory.getOutreachThreadByThreadId === 'function') {
      row = await memory.getOutreachThreadByThreadId(threadId);
    }
    if (row) {
      if (typeof memory.updateOutreachThread === 'function') {
        await memory.updateOutreachThread(row.id, {
          threadId,
          lastMessageId: messageId || row.lastMessageId || null,
          outreachStatus: 'sent',
          approvedTaskId: approvedTaskId || row.approvedTaskId || null,
        });
      }
      return row;
    }
    if (typeof memory.createOutreachThread === 'function' && agentKey) {
      return memory.createOutreachThread({
        threadId,
        recipientEmail: normalizedTo,
        companyName: companyName || null,
        agentKey,
        campaign: campaign || null,
        outreachStatus: 'sent',
        lastMessageId: messageId || null,
        approvedTaskId: approvedTaskId || null,
      });
    }
  } catch {
    // Registry failures must not break a legitimate send that already
    // succeeded against Gmail.
  }
  return null;
}

module.exports = {
  GmailGuardError,
  guardSend,
  guardReply,
  recordSentThread,
  DEDUP_WINDOW_MS,
  fingerprintBody,
};
