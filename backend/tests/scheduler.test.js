// Must be set before requiring scheduler/config below - they capture the
// env var's value at require-time.
process.env.GMAIL_TRIAGE_INTERVAL_MINUTES = '15';

const assert = require('assert');
const memory = require('../memory');
const scheduler = require('../core/scheduler');
const mockProvider = require('../core/providers/mockProvider');

async function main() {
  const now = new Date('2026-08-05T10:00:00');

  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: true, scheduleType: 'interval', intervalMinutes: 30, lastRunAt: null }, now),
    true,
    'never-run interval workflow should be due'
  );
  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: true, scheduleType: 'interval', intervalMinutes: 30, lastRunAt: '2026-08-05T09:40:00' }, now),
    false,
    'interval workflow run 20min ago (needs 30) should not be due yet'
  );
  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: true, scheduleType: 'interval', intervalMinutes: 30, lastRunAt: '2026-08-05T09:29:00' }, now),
    true,
    'interval workflow run 31min ago (needs 30) should be due'
  );
  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: false, scheduleType: 'interval', intervalMinutes: 1, lastRunAt: null }, now),
    false,
    'a disabled workflow should never be due, regardless of schedule'
  );
  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: true, scheduleType: 'daily', dailyTime: '09:00', lastRunAt: null }, now),
    true,
    'daily workflow at 9am, never run, now 10am -> should be due'
  );
  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: true, scheduleType: 'daily', dailyTime: '11:00', lastRunAt: null }, now),
    false,
    'daily workflow at 11am, now 10am -> should not be due yet'
  );
  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: true, scheduleType: 'daily', dailyTime: '09:00', lastRunAt: '2026-08-05T09:05:00' }, now),
    false,
    'daily workflow already ran today after its target time -> should not run again'
  );
  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: true, scheduleType: 'daily', dailyTime: '09:00', lastRunAt: '2026-08-04T09:05:00' }, now),
    true,
    'daily workflow last ran yesterday -> should be due again today'
  );
  assert.strictEqual(now.getDay(), 3, 'sanity check - Aug 5 2026 should be a Wednesday for the day-filter checks below');
  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: true, scheduleType: 'daily', dailyTime: '09:00', daysOfWeek: [1, 2, 3, 4, 5], lastRunAt: null }, now),
    true,
    'weekday-restricted workflow should be due on a Wednesday'
  );
  assert.strictEqual(
    scheduler.isWorkflowDue({ enabled: true, scheduleType: 'daily', dailyTime: '09:00', daysOfWeek: [0, 6], lastRunAt: null }, now),
    false,
    'weekend-restricted workflow should NOT be due on a Wednesday'
  );
  console.log('✓ isWorkflowDue correctly handles interval, daily, disabled, and day-of-week scenarios');

  await scheduler.start();
  scheduler.stop();
  const workflows = await memory.listWorkflows();
  const migrated = workflows.find((w) => w.goal === 'Check my inbox and reply to what needs a reply');
  assert(migrated, 'legacy env var should produce a real workflow');
  assert.strictEqual(migrated.scheduleType, 'interval');
  assert.strictEqual(migrated.intervalMinutes, 15);
  console.log('✓ legacy GMAIL_TRIAGE_INTERVAL_MINUTES correctly migrates into a real workflow');

  await scheduler.start();
  scheduler.stop();
  const workflowsAfterSecondStart = await memory.listWorkflows();
  const migratedCount = workflowsAfterSecondStart.filter((w) => w.goal === 'Check my inbox and reply to what needs a reply').length;
  assert.strictEqual(migratedCount, 1, 'migration must not create duplicates on repeated startup');
  console.log('✓ migration does not create duplicates on repeated startup');

  const created = { id: 'test-wf-crud', name: 'Test', goal: 'Research something', scheduleType: 'interval', intervalMinutes: 60, dailyTime: null, daysOfWeek: null, enabled: true, lastRunAt: null, createdAt: new Date().toISOString() };
  await memory.saveWorkflow(created);
  const fetched = await memory.getWorkflow('test-wf-crud');
  assert.strictEqual(fetched.name, 'Test');
  const updated = await memory.updateWorkflow('test-wf-crud', { enabled: false });
  assert.strictEqual(updated.enabled, false);
  await memory.deleteWorkflow('test-wf-crud');
  assert.strictEqual(await memory.getWorkflow('test-wf-crud'), null);
  console.log('✓ workflow CRUD round-trips correctly through the memory layer');

  const originalComplete = mockProvider.complete;
  mockProvider.complete = async () => ({ text: '[mock] done', provider: 'mock', costEstimate: 0 });
  const manualWf = { id: 'test-wf-run-now', name: 'Manual test', goal: 'Research something', scheduleType: 'interval', intervalMinutes: 60, dailyTime: null, daysOfWeek: null, enabled: true, lastRunAt: null, createdAt: new Date().toISOString() };
  await memory.saveWorkflow(manualWf);
  await scheduler.runWorkflow(manualWf);
  const afterRun = await memory.getWorkflow('test-wf-run-now');
  mockProvider.complete = originalComplete;
  assert(afterRun.lastRunAt !== null, 'running a workflow should record lastRunAt');
  await memory.deleteWorkflow('test-wf-run-now');
  console.log('✓ manually running a workflow executes the goal and records lastRunAt');

  console.log('\nAll scheduler checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
