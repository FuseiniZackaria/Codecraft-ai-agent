const memory = require('../memory');

const AUDIT_LOG_WINDOW = 10000; // enough for meaningful aggregation without being literally unbounded

/**
 * Aggregates real execution data into a dashboard-ready summary. Cost and
 * token figures come from real API usage (see core/providers/aiProvider.js)
 * for anything run through a real key - mock-provider activity always
 * contributes exactly 0 cost/tokens, which is the honest answer, not an
 * estimate.
 */
async function getSummary({ sinceDays = 30 } = {}) {
  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  const [tasks, auditLog, workflowRuns, workflowDefs] = await Promise.all([
    memory.listTasks(),
    memory.getAuditLog(AUDIT_LOG_WINDOW),
    memory.listWorkflowRuns(),
    memory.listWorkflowDefinitions(),
  ]);

  const recentTasks = tasks.filter((t) => t.created_at && new Date(t.created_at).getTime() >= sinceMs);
  const recentAudit = auditLog.filter((a) => a.at && new Date(a.at).getTime() >= sinceMs);
  const recentRuns = workflowRuns.filter((r) => r.startedAt && new Date(r.startedAt).getTime() >= sinceMs);

  const llmCalls = recentAudit.filter((a) => a.action === 'llm_call');
  const totalCost = llmCalls.reduce((sum, a) => sum + (a.metadata?.cost || 0), 0);
  const totalInputTokens = llmCalls.reduce((sum, a) => sum + (a.metadata?.inputTokens || 0), 0);
  const totalOutputTokens = llmCalls.reduce((sum, a) => sum + (a.metadata?.outputTokens || 0), 0);

  const costByAgent = {};
  for (const call of llmCalls) {
    const agent = call.actor || 'unknown';
    costByAgent[agent] = (costByAgent[agent] || 0) + (call.metadata?.cost || 0);
  }

  const costByDayMap = {};
  for (const call of llmCalls) {
    const day = (call.at || '').slice(0, 10);
    if (!day) continue;
    costByDayMap[day] = (costByDayMap[day] || 0) + (call.metadata?.cost || 0);
  }
  const dailyCostSeries = Object.entries(costByDayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cost]) => ({ date, cost }));

  const tasksByStatus = {};
  for (const t of recentTasks) {
    tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1;
  }
  const successCount = tasksByStatus.done || 0;
  const failCount = tasksByStatus.failed || 0;
  const successRate = successCount + failCount > 0 ? successCount / (successCount + failCount) : null;

  const durations = recentTasks
    .filter((t) => t.status === 'done' || t.status === 'failed')
    .map((t) => new Date(t.updated_at).getTime() - new Date(t.created_at).getTime())
    .filter((d) => Number.isFinite(d) && d >= 0);
  const avgDurationMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const runsByStatus = {};
  for (const r of recentRuns) {
    runsByStatus[r.status] = (runsByStatus[r.status] || 0) + 1;
  }
  const workflowNameById = Object.fromEntries(workflowDefs.map((w) => [w.id, w.name]));
  const runsByWorkflow = {};
  for (const r of recentRuns) {
    const name = workflowNameById[r.workflowId] || r.workflowId;
    if (!runsByWorkflow[name]) runsByWorkflow[name] = { total: 0, done: 0, failed: 0 };
    runsByWorkflow[name].total += 1;
    if (r.status === 'done') runsByWorkflow[name].done += 1;
    if (r.status === 'failed') runsByWorkflow[name].failed += 1;
  }

  return {
    sinceDays,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    totalLlmCalls: llmCalls.length,
    costByAgent,
    dailyCostSeries,
    tasksByStatus,
    successRate,
    avgDurationMs,
    totalTasks: recentTasks.length,
    runsByStatus,
    runsByWorkflow,
    totalWorkflowRuns: recentRuns.length,
  };
}

function extractResultText(result) {
  if (!result) return '';
  if (Array.isArray(result)) {
    const last = [...result].reverse().find((s) => s?.text);
    return last?.text || '';
  }
  if (typeof result === 'object' && result.error) return `Error: ${result.error}`;
  return typeof result === 'string' ? result : '';
}

/**
 * A short, readable summary of what's actually happened recently - real
 * signal for a self-prompting decision to reason from, instead of asking
 * "is anything worth doing?" with nothing to go on.
 */
async function getRecentActivitySummary({ limit = 5 } = {}) {
  const tasks = await memory.listTasks();
  const recent = tasks
    .filter((t) => t.status === 'done' || t.status === 'failed')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, limit);

  if (!recent.length) return 'No recent activity yet.';

  const lines = recent.map((t) => {
    const status = t.status === 'done' ? 'succeeded' : 'FAILED';
    const resultText = extractResultText(t.result);
    return `- [${status}] ${t.agent}: "${t.instruction}"${resultText ? ` -> ${resultText.slice(0, 150)}` : ''}`;
  });

  return `Recent activity:\n${lines.join('\n')}`;
}

module.exports = { getSummary, getRecentActivitySummary };
