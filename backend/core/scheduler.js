const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const memory = require('../memory');
const orchestrator = require('./orchestrator');
const workflowEngine = require('./workflowEngine');

const TICK_INTERVAL_MS = 60 * 1000; // check every minute - fine-grained enough for both interval and daily schedules
let timer = null;
const runningIds = new Set(); // avoid overlapping runs of the SAME workflow if one is still in progress

// In-memory last-run tracking for the two outreach automation jobs below.
// Not persisted to disk on purpose - both jobs are idempotent (dedup logic
// already tested in Phase 3/4: re-running never double-sends or
// double-processes), so losing precision across a server restart just
// means "runs once immediately on startup" rather than causing any actual
// harm. Simpler than adding new schema/storage for two timestamps.
let lastResponseCheckAt = null;
let lastFollowUpCheckAt = null;
let outreachJobRunning = false; // both share one flag - they touch the same pipeline records, keep them sequential not concurrent

// Video file extensions recognized by folder-watch triggers.
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];

/**
 * Pure function: given a workflow and the current time, is it due to run?
 * Exported and tested directly - no timers, no waiting, fully deterministic.
 */
function isWorkflowDue(workflow, now = new Date()) {
  if (!workflow.enabled) return false;

  if (workflow.scheduleType === 'interval') {
    if (!workflow.intervalMinutes || workflow.intervalMinutes <= 0) return false;
    if (!workflow.lastRunAt) return true;
    const elapsedMs = now.getTime() - new Date(workflow.lastRunAt).getTime();
    return elapsedMs >= workflow.intervalMinutes * 60 * 1000;
  }

  if (workflow.scheduleType === 'daily') {
    if (!workflow.dailyTime) return false;
    const [hour, minute] = workflow.dailyTime.split(':').map(Number);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return false;

    const dayOk = !workflow.daysOfWeek?.length || workflow.daysOfWeek.includes(now.getDay());
    if (!dayOk) return false;

    const todayTarget = new Date(now);
    todayTarget.setHours(hour, minute, 0, 0);
    if (now < todayTarget) return false; // hasn't hit today's time yet

    // Due if we've passed today's target time and haven't already run since then.
    if (!workflow.lastRunAt) return true;
    return new Date(workflow.lastRunAt).getTime() < todayTarget.getTime();
  }

  return false;
}

/**
 * Checks a folder-watch workflow definition for a new, not-yet-processed
 * video file. Returns the oldest qualifying file's absolute path, or null.
 * Processing the OLDEST first (one per tick) means if several files land at
 * once, they're handled one at a time across ticks rather than all firing
 * simultaneously - lastRunAt only advances once a file is actually picked up.
 */
function checkFolderWatch(definition) {
  if (!definition.watchFolder) return null;
  if (!fs.existsSync(definition.watchFolder)) {
    console.warn(`[scheduler] watch folder does not exist: ${definition.watchFolder}`);
    return null;
  }

  const sinceMs = definition.lastRunAt ? new Date(definition.lastRunAt).getTime() : new Date(definition.createdAt).getTime();

  const candidates = fs
    .readdirSync(definition.watchFolder)
    .filter((name) => VIDEO_EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .map((name) => {
      const fullPath = path.join(definition.watchFolder, name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .filter((f) => f.mtimeMs > sinceMs)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  return candidates.length ? candidates[0].fullPath : null;
}

async function runWorkflow(workflow) {
  if (runningIds.has(workflow.id)) return; // previous run still in progress
  runningIds.add(workflow.id);
  try {
    console.log(`[scheduler] running workflow "${workflow.name}": ${workflow.goal}`);
    await orchestrator.submitGoal(workflow.goal);
    await memory.updateWorkflow(workflow.id, { lastRunAt: new Date().toISOString() });
  } catch (err) {
    console.warn(`[scheduler] workflow "${workflow.name}" failed: ${err.message}`);
    // Still record the attempt time, so a persistently-failing workflow
    // doesn't retry every single tick forever - it gets another shot on its
    // normal schedule instead.
    await memory.updateWorkflow(workflow.id, { lastRunAt: new Date().toISOString() }).catch(() => {});
  } finally {
    runningIds.delete(workflow.id);
  }
}

async function runGraphWorkflow(definition, triggerOutput) {
  if (runningIds.has(definition.id)) return;
  runningIds.add(definition.id);
  try {
    console.log(`[scheduler] running graph workflow "${definition.name}"${triggerOutput ? ` (trigger file: ${triggerOutput})` : ''}`);
    await workflowEngine.runWorkflow(definition.id, triggerOutput);
  } catch (err) {
    console.warn(`[scheduler] graph workflow "${definition.name}" failed: ${err.message}`);
  } finally {
    await memory.updateWorkflowDefinition(definition.id, { lastRunAt: new Date().toISOString() }).catch(() => {});
    runningIds.delete(definition.id);
  }
}

/**
 * Checks the inbox for replies to sent job outreach and classifies them.
 * Disabled by default (config.automation.responseCheckIntervalMinutes = 0) -
 * same "off unless explicitly enabled" pattern as every other automated
 * send/action in this codebase.
 */
async function runOutreachResponseCheck() {
  try {
    const { getAgent } = require('../agents/registry');
    const agent = getAgent('response-detection');
    const result = await agent.detectResponses();
    if (result.matched > 0) {
      console.log(`[scheduler] outreach response check: matched ${result.matched} new response(s)`);
    }
  } catch (err) {
    console.warn(`[scheduler] outreach response check failed: ${err.message}`);
  }
}

/**
 * Queues any due follow-up emails (Day 4/10/21 sequence) for sent outreach
 * that hasn't received a genuine response. Disabled by default
 * (config.automation.followUpCheckIntervalMinutes = 0).
 */
async function runOutreachFollowUpCheck() {
  try {
    const outreachPipeline = require('./outreachPipeline');
    const result = await outreachPipeline.checkFollowUps();
    if (result.queued > 0) {
      console.log(`[scheduler] outreach follow-up check: queued ${result.queued} follow-up(s) for approval`);
    }
  } catch (err) {
    console.warn(`[scheduler] outreach follow-up check failed: ${err.message}`);
  }
}

/**
 * Runs the two outreach automation jobs if their configured interval has
 * elapsed. Both share one "is anything running" guard (outreachJobRunning)
 * since they touch the same pipeline records - sequential, not concurrent,
 * avoids any read-modify-write race between them.
 */
async function tickOutreachAutomation(now = new Date()) {
  if (outreachJobRunning) return;

  const responseDue =
    config.automation.responseCheckIntervalMinutes > 0 &&
    (!lastResponseCheckAt || now.getTime() - lastResponseCheckAt.getTime() >= config.automation.responseCheckIntervalMinutes * 60 * 1000);

  const followUpDue =
    config.automation.followUpCheckIntervalMinutes > 0 &&
    (!lastFollowUpCheckAt || now.getTime() - lastFollowUpCheckAt.getTime() >= config.automation.followUpCheckIntervalMinutes * 60 * 1000);

  if (!responseDue && !followUpDue) return;

  outreachJobRunning = true;
  try {
    if (responseDue) {
      await runOutreachResponseCheck();
      lastResponseCheckAt = now;
    }
    if (followUpDue) {
      await runOutreachFollowUpCheck();
      lastFollowUpCheckAt = now;
    }
  } finally {
    outreachJobRunning = false;
  }
}

async function tick() {
  let workflows;
  try {
    workflows = await memory.listWorkflows();
  } catch (err) {
    console.warn(`[scheduler] failed to list workflows: ${err.message}`);
    return;
  }
  const due = workflows.filter((w) => isWorkflowDue(w));
  for (const workflow of due) {
    runWorkflow(workflow); // deliberately not awaited - workflows run concurrently, independent of each other
  }

  // Graph-based workflow_definitions - previously never automatically
  // triggered at all (only manual POST /run worked). Interval/daily reuse
  // the exact same isWorkflowDue check as the simple system above, since
  // both share the same field shape. folder_watch is new.
  let definitions;
  try {
    definitions = await memory.listWorkflowDefinitions();
  } catch (err) {
    console.warn(`[scheduler] failed to list workflow definitions: ${err.message}`);
    return;
  }
  for (const definition of definitions) {
    if (!definition.enabled) continue;
    if (definition.scheduleType === 'interval' || definition.scheduleType === 'daily') {
      if (isWorkflowDue(definition)) runGraphWorkflow(definition, null);
    } else if (definition.scheduleType === 'folder_watch') {
      const filePath = checkFolderWatch(definition);
      if (filePath) runGraphWorkflow(definition, filePath);
    }
  }

  // Job outreach automation - separate from the Workflow system above since
  // these are structured internal maintenance jobs, not natural-language
  // goals. Both no-op unless explicitly enabled via config.
  tickOutreachAutomation(); // deliberately not awaited - runs independently of workflow ticks, same as runWorkflow() above
}

/**
 * One-time migration: if the old GMAIL_TRIAGE_INTERVAL_MINUTES env var is
 * set and no equivalent workflow exists yet, create one - so anyone who had
 * the old env-var-only scheduler configured doesn't silently lose it when
 * upgrading to the real Workflows system.
 */
async function migrateLegacyGmailTriage() {
  const minutes = config.scheduler.gmailTriageIntervalMinutes;
  if (!minutes || minutes <= 0) return;

  const existing = await memory.listWorkflows();
  const alreadyMigrated = existing.some((w) => w.goal === 'Check my inbox and reply to what needs a reply');
  if (alreadyMigrated) return;

  await memory.saveWorkflow({
    id: uuid(),
    name: 'Gmail auto-triage (migrated)',
    goal: 'Check my inbox and reply to what needs a reply',
    scheduleType: 'interval',
    intervalMinutes: minutes,
    dailyTime: null,
    daysOfWeek: null,
    enabled: true,
    lastRunAt: null,
    createdAt: new Date().toISOString(),
  });
  console.log(`[scheduler] migrated GMAIL_TRIAGE_INTERVAL_MINUTES (${minutes}min) into a real workflow - manage it from the Workflows page now`);
}

async function start() {
  await migrateLegacyGmailTriage().catch((err) => console.warn(`[scheduler] legacy migration failed: ${err.message}`));

  console.log('[scheduler] started - checking workflows every minute');
  tick(); // also check immediately at startup
  timer = setInterval(tick, TICK_INTERVAL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
}

module.exports = {
  start,
  stop,
  tick,
  isWorkflowDue,
  runWorkflow,
  checkFolderWatch,
  runGraphWorkflow,
  tickOutreachAutomation,
  runOutreachResponseCheck,
  runOutreachFollowUpCheck,
};