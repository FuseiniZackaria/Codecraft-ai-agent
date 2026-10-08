const orchestrator = require('../orchestrator');
const memory = require('../../memory');
const { departmentForTool } = require('./tools');

/**
 * Each handler returns a plain object that gets JSON-serialised back to
 * Claude as the tool_result content. Keep results compact - the whole
 * conversation history (including tool_result blocks) gets echoed back
 * on every subsequent turn.
 */

function summariseTask(task) {
  if (!task) return { ok: false, error: 'no task was created' };
  if (task._mismatch) {
    return {
      ok: false,
      error: 'department_mismatch',
      note: `This instruction would run in the "${task.suggestedLabel}" department instead. Call the matching run_* tool with the same instruction.`,
    };
  }
  const base = {
    ok: true,
    task_id: task.id,
    agent: task.agent,
    status: task.status,
    instruction: task.instruction,
  };
  if (task.status === 'pending_approval') {
    base.needs_approval = true;
    base.note = 'Drafted and waiting for the user to approve on the Tasks page (or inline in chat).';
    if (task.payload) base.draft = compactPayload(task.payload);
  } else if (task.status === 'done') {
    base.result_summary = summariseResult(task.result);
  } else if (task.status === 'failed') {
    base.error = task.result?.error || 'task failed';
  }
  return base;
}

function compactPayload(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'string' && v.length > 400) out[k] = v.slice(0, 400) + '…';
    else out[k] = v;
  }
  return out;
}

// Cap on what we feed back to Claude as a tool_result. Big enough to carry
// a 5-10 lead list with details; small enough to not blow the context on a
// chatty agent. If the agent's output exceeds this, we keep the TAIL (which
// usually contains the final synthesis) rather than the head.
const MAX_TOOL_RESULT_CHARS = 8000;

function clip(text, max = MAX_TOOL_RESULT_CHARS) {
  if (typeof text !== 'string') return text;
  if (text.length <= max) return text;
  return `…(earlier output truncated)…\n${text.slice(-max)}`;
}

function summariseResult(result) {
  if (!result) return null;
  if (Array.isArray(result)) {
    // Concatenate text from EVERY step, not just the last - the actual
    // deliverable (lead list, draft text, research findings) often lives
    // in a middle step while the last step is just a short confirmation.
    const parts = result
      .map((s) => (typeof s === 'string' ? s : s?.text || (s?.error ? `error: ${s.error}` : null)))
      .filter(Boolean);
    if (parts.length === 0) return `${result.length} step(s) completed.`;
    return clip(parts.join('\n\n'));
  }
  if (typeof result === 'string') return clip(result);
  if (result.text) return clip(result.text);
  return result;
}

async function runDepartmentTask(toolName, input, context) {
  const department = departmentForTool(toolName);
  if (!department) return { ok: false, error: `unknown department tool: ${toolName}` };
  const instruction = input?.instruction;
  if (!instruction || !String(instruction).trim()) {
    return { ok: false, error: 'instruction is required' };
  }

  const results = await orchestrator.submitGoal(instruction, {
    departmentKey: department,
    history: context?.history || [],
  });

  const first = results[0];
  if (context?.collectedTaskIds && first?.id) context.collectedTaskIds.push(first.id);
  return summariseTask(first);
}

async function listPendingApprovals() {
  const tasks = await memory.listTasks();
  const pending = tasks
    .filter((t) => t.status === 'pending_approval')
    .slice(0, 20)
    .map((t) => ({ task_id: t.id, agent: t.agent, instruction: t.instruction, created_at: t.created_at }));
  return { count: pending.length, pending };
}

async function checkTaskResult(input) {
  const task = await memory.getTask(input?.task_id);
  if (!task) return { ok: false, error: `task not found: ${input?.task_id}` };
  return summariseTask(task);
}

const HANDLERS = {
  run_sales_task: runDepartmentTask,
  run_marketing_task: runDepartmentTask,
  run_support_task: runDepartmentTask,
  run_strategy_task: runDepartmentTask,
  run_development_task: runDepartmentTask,
  list_pending_approvals: () => listPendingApprovals(),
  check_task_result: (name, input) => checkTaskResult(input),
};

async function invoke(toolName, input, context) {
  const handler = HANDLERS[toolName];
  if (!handler) return { ok: false, error: `unknown tool: ${toolName}` };
  try {
    return await handler(toolName, input, context);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { invoke };
