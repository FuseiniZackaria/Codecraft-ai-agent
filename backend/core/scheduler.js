const config = require('../config');
const orchestrator = require('./orchestrator');

let timer = null;
let running = false;

async function runOnce() {
  if (running) return; // avoid overlapping runs if one is still in progress
  running = true;
  try {
    console.log('[scheduler] running scheduled inbox triage...');
    await orchestrator.submitGoal('Check my inbox and reply to what needs a reply');
  } catch (err) {
    console.warn(`[scheduler] inbox triage failed: ${err.message}`);
  } finally {
    running = false;
  }
}

function start() {
  const minutes = config.scheduler.gmailTriageIntervalMinutes;
  if (!minutes || minutes <= 0) {
    console.log('[scheduler] Gmail auto-triage disabled (set GMAIL_TRIAGE_INTERVAL_MINUTES to enable)');
    return;
  }
  console.log(`[scheduler] Gmail auto-triage enabled - running every ${minutes} minute(s)`);
  runOnce(); // also run once immediately at startup
  timer = setInterval(runOnce, minutes * 60 * 1000);
}

function stop() {
  if (timer) clearInterval(timer);
}

module.exports = { start, stop, runOnce };
