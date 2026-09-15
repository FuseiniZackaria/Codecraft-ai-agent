const assert = require('assert');

const scheduler = require('../core/scheduler');
const config = require('../config');
const { getAgent } = require('../agents/registry');
const outreachPipeline = require('../core/outreachPipeline');

async function main() {
  const originalResponseInterval = config.automation.responseCheckIntervalMinutes;
  const originalFollowUpInterval = config.automation.followUpCheckIntervalMinutes;

  // --- Both disabled by default (0) - tickOutreachAutomation must be a true no-op ---
  config.automation.responseCheckIntervalMinutes = 0;
  config.automation.followUpCheckIntervalMinutes = 0;

  const responseAgent = getAgent('response-detection');
  let detectCalls = 0;
  const originalDetect = responseAgent.detectResponses.bind(responseAgent);
  responseAgent.detectResponses = async (...args) => { detectCalls++; return originalDetect(...args); };

  let followUpCalls = 0;
  const originalCheckFollowUps = outreachPipeline.checkFollowUps;
  outreachPipeline.checkFollowUps = async (...args) => { followUpCalls++; return originalCheckFollowUps(...args); };

  await scheduler.tickOutreachAutomation();
  assert.strictEqual(detectCalls, 0, 'response check must not run when its interval is 0 (disabled)');
  assert.strictEqual(followUpCalls, 0, 'follow-up check must not run when its interval is 0 (disabled)');
  console.log('✓ tickOutreachAutomation: both jobs are true no-ops when disabled (interval = 0), matching the safe-by-default pattern');

  // --- Response check enabled, runs once when due, not again immediately after ---
  config.automation.responseCheckIntervalMinutes = 60; // 1 hour
  config.automation.followUpCheckIntervalMinutes = 0;

  const now = new Date();
  await scheduler.tickOutreachAutomation(now);
  assert.strictEqual(detectCalls, 1, 'response check should run once it is enabled and due (no prior run recorded)');
  assert.strictEqual(followUpCalls, 0, 'follow-up check should still not run - it is disabled');
  console.log('✓ tickOutreachAutomation: enabled response check runs on first due tick');

  // Immediately after - same "now" plus a few seconds, well within the 60 min interval.
  const soonAfter = new Date(now.getTime() + 5000);
  await scheduler.tickOutreachAutomation(soonAfter);
  assert.strictEqual(detectCalls, 1, 'response check must NOT run again before its interval has elapsed');
  console.log('✓ tickOutreachAutomation: does not re-run the response check before its interval elapses');

  // An hour and a bit later - interval has now elapsed, should run again.
  const muchLater = new Date(now.getTime() + 61 * 60 * 1000);
  await scheduler.tickOutreachAutomation(muchLater);
  assert.strictEqual(detectCalls, 2, 'response check should run again once its interval has genuinely elapsed');
  console.log('✓ tickOutreachAutomation: runs the response check again once its interval has genuinely elapsed');

  // --- Follow-up check enabled independently ---
  config.automation.responseCheckIntervalMinutes = 0;
  config.automation.followUpCheckIntervalMinutes = 1440; // once a day
  const laterStill = new Date(muchLater.getTime() + 1000);
  await scheduler.tickOutreachAutomation(laterStill);
  assert.strictEqual(followUpCalls, 1, 'follow-up check should run once enabled and due');
  assert.strictEqual(detectCalls, 2, 'response check should NOT run - it is disabled again');
  console.log('✓ tickOutreachAutomation: the two jobs run independently based on their own settings');

  // --- A failure in one job must not prevent the other, and must not throw ---
  config.automation.responseCheckIntervalMinutes = 60;
  config.automation.followUpCheckIntervalMinutes = 1440;
  responseAgent.detectResponses = async () => { throw new Error('simulated failure'); };
  let followUpCallsBefore = followUpCalls;
  const wayLater = new Date(laterStill.getTime() + 25 * 60 * 60 * 1000);
  await scheduler.tickOutreachAutomation(wayLater); // must not throw despite the simulated failure above
  assert(followUpCalls > followUpCallsBefore, 'a failure in the response check must not prevent the follow-up check from still running');
  console.log('✓ tickOutreachAutomation: a failure in one job does not crash the scheduler or block the other job');

  // Restore everything
  responseAgent.detectResponses = originalDetect;
  outreachPipeline.checkFollowUps = originalCheckFollowUps;
  config.automation.responseCheckIntervalMinutes = originalResponseInterval;
  config.automation.followUpCheckIntervalMinutes = originalFollowUpInterval;

  console.log('\nAll outreach automation scheduler checks passed.');
}

main().catch((err) => {
  console.error('✗ outreach-automation.test.js failed:', err);
  process.exit(1);
});