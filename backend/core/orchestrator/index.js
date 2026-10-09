const { decompose } = require('./planner');
const { getAgent } = require('../../agents/registry');
const toolRegistry = require('../../tools/ToolRegistry');
const memory = require('../../memory');
const activityLog = require('../activityLog');

/**
 * submitGoal: entry point for "Receives requests -> decompose -> assign ->
 * execute (with approval gate) -> review -> respond" from the architecture doc.
 *
 * @param {string} goal - natural language goal
 * @param {object} options - { payload, overrideProvider, history, category }
 */
async function submitGoal(goal, options = {}) {
  const tasks = await decompose(goal, options.payload, options.history, options.category, options.departmentKey, options.agentKey);

  if (tasks[0]?._mismatch) return tasks;

  const results = [];
  const workspaceId = options.workspaceId || null;

  for (const task of tasks) {
    task.overrideProvider = options.overrideProvider;
    // Phase 2.3: stamp workspace_id on every task row so downstream reads
    // can filter by workspace and the shadow guard sees the scope.
    if (workspaceId) task.workspace_id = workspaceId;
    await memory.saveTask(task, { workspaceId });
    await activityLog.record('orchestrator', 'task_queued', task.agent, { taskId: task.id, instruction: task.instruction, workspaceId });

    if (task.irreversible) {
      // Block on human approval - do not execute yet. Preserve whatever
      // payload the planner extracted (or the caller supplied explicitly).
      await memory.updateTask(task.id, { status: 'pending_approval', payload: options.payload || task.payload }, { workspaceId });
      await activityLog.record('orchestrator', 'approval_required', task.toolCall.tool, { taskId: task.id, workspaceId });
      results.push(await memory.getTask(task.id));
      continue;
    }

    const agent = getAgent(task.agent);
    try {
      const agentResults = await agent.run(task);
      const updated = await memory.updateTask(task.id, { status: 'done', result: agentResults }, { workspaceId });
      results.push(updated);
    } catch (err) {
      const updated = await memory.updateTask(task.id, { status: 'failed', result: { error: err.message } }, { workspaceId });
      results.push(updated);
    }
  }

  return results;
}

/**
 * approveTask: called from the dashboard/API when a human approves a
 * pending_approval task. Executes the originally requested tool call.
 */
async function approveTask(taskId, options = {}) {
  const task = await memory.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== 'pending_approval') {
    throw new Error(`Task ${taskId} is not awaiting approval (status: ${task.status})`);
  }
  // Phase 2.3: use the task's own workspace_id for shadow-guard scope so a
  // caller that didn't pass workspaceId still produces a scope-aware trace.
  const workspaceId = options.workspaceId || task.workspace_id || null;

  // The human's approval decision is logged regardless of what happens next -
  // execution failing (e.g. Gmail not connected) doesn't mean they didn't approve it.
  await activityLog.record('human', 'task_approved', task.toolCall.tool, { taskId, workspaceId });

  try {
    // approvedTaskId is read by the Gmail guard (plugins/gmail/guard.js) to
    // confirm this call is being dispatched by the approval flow rather than
    // some agent calling the tool directly. Every irreversible tool should
    // honor the same pattern as it adopts a guard.
    const result = await toolRegistry.call(task.toolCall.tool, task.payload || {}, {
      role: task.agent,
      approvedTaskId: task.id,
      approvedAt: new Date().toISOString(),
      workspaceId,
    });
    await activityLog.record('orchestrator', 'tool_call', task.toolCall.tool, { taskId, status: 'done', workspaceId });
    return memory.updateTask(taskId, { status: 'done', result }, { workspaceId });
  } catch (err) {
    await activityLog.record('orchestrator', 'task_execution_failed', task.toolCall.tool, { taskId, error: err.message, workspaceId });
    return memory.updateTask(taskId, { status: 'failed', result: { error: err.message } }, { workspaceId });
  }
}

async function rejectTask(taskId, options = {}) {
  const task = await memory.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const workspaceId = options.workspaceId || task.workspace_id || null;
  await activityLog.record('human', 'task_rejected', task.toolCall?.tool || task.agent, { taskId, workspaceId });
  return memory.updateTask(taskId, { status: 'rejected' }, { workspaceId });
}

module.exports = { submitGoal, approveTask, rejectTask };
