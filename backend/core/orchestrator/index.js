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
 * @param {object} options - { payload, overrideProvider, history }
 */
async function submitGoal(goal, options = {}) {
  const tasks = await decompose(goal, options.payload, options.history);
  const results = [];

  for (const task of tasks) {
    task.overrideProvider = options.overrideProvider;
    await memory.saveTask(task);
    await activityLog.record('orchestrator', 'task_queued', task.agent, { taskId: task.id, instruction: task.instruction });

    if (task.irreversible) {
      // Block on human approval - do not execute yet. Preserve whatever
      // payload the planner extracted (or the caller supplied explicitly).
      await memory.updateTask(task.id, { status: 'pending_approval', payload: options.payload || task.payload });
      await activityLog.record('orchestrator', 'approval_required', task.toolCall.tool, { taskId: task.id });
      results.push(await memory.getTask(task.id));
      continue;
    }

    const agent = getAgent(task.agent);
    try {
      const agentResults = await agent.run(task);
      const updated = await memory.updateTask(task.id, { status: 'done', result: agentResults });
      results.push(updated);
    } catch (err) {
      const updated = await memory.updateTask(task.id, { status: 'failed', result: { error: err.message } });
      results.push(updated);
    }
  }

  return results;
}

/**
 * approveTask: called from the dashboard/API when a human approves a
 * pending_approval task. Executes the originally requested tool call.
 */
async function approveTask(taskId) {
  const task = await memory.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== 'pending_approval') {
    throw new Error(`Task ${taskId} is not awaiting approval (status: ${task.status})`);
  }

  // The human's approval decision is logged regardless of what happens next -
  // execution failing (e.g. Gmail not connected) doesn't mean they didn't approve it.
  await activityLog.record('human', 'task_approved', task.toolCall.tool, { taskId });

  try {
    const result = await toolRegistry.call(task.toolCall.tool, task.payload || {}, {
      role: task.agent,
    });
    await activityLog.record('orchestrator', 'tool_call', task.toolCall.tool, { taskId, status: 'done' });
    return memory.updateTask(taskId, { status: 'done', result });
  } catch (err) {
    await activityLog.record('orchestrator', 'task_execution_failed', task.toolCall.tool, { taskId, error: err.message });
    return memory.updateTask(taskId, { status: 'failed', result: { error: err.message } });
  }
}

async function rejectTask(taskId) {
  const task = await memory.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  await activityLog.record('human', 'task_rejected', task.toolCall?.tool || task.agent, { taskId });
  return memory.updateTask(taskId, { status: 'rejected' });
}

module.exports = { submitGoal, approveTask, rejectTask };
