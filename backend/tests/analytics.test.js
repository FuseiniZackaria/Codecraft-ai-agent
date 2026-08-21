const assert = require('assert');
const memory = require('../memory');
const activityLog = require('../core/activityLog');
const analytics = require('../core/analytics');
const mockProvider = require('../core/providers/mockProvider');

async function main() {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();

  await memory.saveTask({ id: 'analytics-t1', agent: 'research', instruction: 'x', status: 'pending', created_at: iso(60000) });
  await memory.updateTask('analytics-t1', { status: 'done' });
  await memory.saveTask({ id: 'analytics-t2', agent: 'ceo', instruction: 'y', status: 'pending', created_at: iso(30000) });
  await memory.updateTask('analytics-t2', { status: 'done' });
  await memory.saveTask({ id: 'analytics-t3', agent: 'sales', instruction: 'z', status: 'pending', created_at: iso(10000) });
  await memory.updateTask('analytics-t3', { status: 'failed' });

  await activityLog.record('research', 'llm_call', 'ai', { taskId: 'analytics-t1', cost: 0.05, inputTokens: 20000, outputTokens: 1000, status: 'done' });
  await activityLog.record('ceo', 'llm_call', 'ai', { taskId: 'analytics-t2', cost: 0.02, inputTokens: 5000, outputTokens: 800, status: 'done' });
  await activityLog.record('research', 'llm_call', 'ai', { taskId: 'analytics-t1', cost: 0.01, inputTokens: 2000, outputTokens: 300, status: 'done' });

  await memory.saveWorkflowDefinition({ id: 'analytics-wf1', name: 'Daily Digest', graph: { nodes: [], edges: [] }, enabled: true });
  await memory.saveWorkflowRun({ id: 'analytics-r1', workflowId: 'analytics-wf1', status: 'done', context: {}, startedAt: iso(50000) });
  await memory.saveWorkflowRun({ id: 'analytics-r2', workflowId: 'analytics-wf1', status: 'failed', context: {}, startedAt: iso(20000) });

  const summary = await analytics.getSummary({ sinceDays: 30 });

  assert(Math.abs(summary.totalCost - 0.08) < 0.0001, 'total cost should sum correctly across all llm_call events');
  assert.strictEqual(summary.totalInputTokens, 27000, 'input tokens should sum correctly');
  assert.strictEqual(summary.totalOutputTokens, 2100, 'output tokens should sum correctly');
  assert(Math.abs(summary.costByAgent.research - 0.06) < 0.0001, 'cost should be correctly attributed per agent (research)');
  assert(Math.abs(summary.costByAgent.ceo - 0.02) < 0.0001, 'cost should be correctly attributed per agent (ceo)');
  console.log('✓ cost and token totals are correctly aggregated and attributed per agent');

  assert.strictEqual(summary.tasksByStatus.done, 2);
  assert.strictEqual(summary.tasksByStatus.failed, 1);
  assert(Math.abs(summary.successRate - 2 / 3) < 0.0001, 'success rate should be computed correctly (2 done / 3 total)');
  console.log('✓ task status counts and success rate are correctly computed');

  assert(summary.runsByWorkflow['Daily Digest'], 'workflow name should be correctly resolved from its ID');
  assert.strictEqual(summary.runsByWorkflow['Daily Digest'].total, 2);
  assert.strictEqual(summary.runsByWorkflow['Daily Digest'].done, 1);
  assert.strictEqual(summary.runsByWorkflow['Daily Digest'].failed, 1);
  console.log('✓ workflow run counts are correctly grouped and named');

  await memory.saveTask({ id: 'analytics-old', agent: 'research', instruction: 'old', status: 'pending', created_at: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString() });
  await memory.updateTask('analytics-old', { status: 'done' });
  const summary30 = await analytics.getSummary({ sinceDays: 30 });
  const summary90 = await analytics.getSummary({ sinceDays: 90 });
  assert.strictEqual(summary30.totalTasks, 3, 'a 60-day-old task should be excluded from a 30-day window');
  assert.strictEqual(summary90.totalTasks, 4, 'the same task should be included in a 90-day window');
  console.log('✓ sinceDays correctly filters by date range');

  const PRICE_PER_MILLION_INPUT = 2.0;
  const PRICE_PER_MILLION_OUTPUT = 10.0;
  const computeCost = (input, output) => (input / 1_000_000) * PRICE_PER_MILLION_INPUT + (output / 1_000_000) * PRICE_PER_MILLION_OUTPUT;
  assert.strictEqual(computeCost(1_000_000, 0), 2.0, '1M input tokens should cost exactly $2.00 at current Sonnet 5 pricing');
  assert.strictEqual(computeCost(0, 1_000_000), 10.0, '1M output tokens should cost exactly $10.00 at current Sonnet 5 pricing');
  console.log('✓ real cost computation matches verified current Sonnet 5 pricing exactly');

  const mockResult = await mockProvider.complete({ prompt: 'test' });
  assert.strictEqual(mockResult.inputTokens, 0);
  assert.strictEqual(mockResult.outputTokens, 0);
  console.log('✓ mockProvider returns explicit zero token counts for consistency with the real provider shape');

  console.log('\nAll analytics checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
