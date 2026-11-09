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

// A page the Browser agent read ({ url, title, text, contacts? } - LLM steps
// carry a `provider`, page reads don't). Its text is raw page content the
// next step already summarised, so Ian gets only what was read and the
// contact details found, not the page itself.
function pageReadLine(step) {
  if (!step || typeof step.url !== 'string' || typeof step.text !== 'string' || !('title' in step) || step.provider) return null;
  const c = step.contacts;
  if (!c) return `Read page: ${step.title || step.url} (${step.url})`;
  return [
    '=== CONTACT DETAILS FOUND ===',
    `Emails: ${c.emails?.length ? c.emails.join(', ') : 'none found'}`,
    `Phones: ${c.phones?.length ? c.phones.join(', ') : 'none found'}`,
    `Pages checked: ${(c.pagesChecked || [step.url]).join(', ')}`,
  ].join('\n');
}

function summariseResult(result) {
  if (!result) return null;
  if (Array.isArray(result)) {
    // Concatenate text from EVERY step, not just the last - the actual
    // deliverable (lead list, draft text, research findings) often lives
    // in a middle step while the last step is just a short confirmation.
    const parts = result
      .map((s) => (typeof s === 'string' ? s : pageReadLine(s) || s?.text || (s?.error ? `error: ${s.error}` : null)))
      .filter(Boolean);
    if (parts.length === 0) return `${result.length} step(s) completed.`;
    return clip(parts.join('\n\n'));
  }
  if (typeof result === 'string') return clip(result);
  if (result.text) return clip(result.text);
  return result;
}

// Lookups (reading a website, researching a person/topic) are reused for a
// while: a follow-up like "so what do they do?" shouldn't open the site again
// for another ~30s. Only read-only agents are reused - drafts and actions
// always run. The user saying "recheck", "refresh", "again" etc. skips reuse.
const REUSABLE_AGENTS = new Set(['browser', 'research']);
const LOOKUP_REUSE_MS = 10 * 60 * 1000;
const RERUN_WORDS = /\b(re-?check|refresh|again|re-?run|update[ds]?|latest|changed?|look again|new)\b/i;
const recentLookups = new Map(); // key -> { at, summary }

function lookupKey(toolName, instruction, workspaceId) {
  // Ian words each request a little differently, so a website is keyed by its domain.
  const domain = /(?<![@\w.-])((?:[a-z0-9-]+\.)+[a-z]{2,})(?![\w@])/i.exec(instruction)?.[1]?.toLowerCase().replace(/^www\./, '');
  const subject = domain || String(instruction).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${workspaceId || 'legacy'}|${toolName}|${subject}`;
}

async function runDepartmentTask(toolName, input, context) {
  const department = departmentForTool(toolName);
  if (!department) return { ok: false, error: `unknown department tool: ${toolName}` };
  const instruction = input?.instruction;
  if (!instruction || !String(instruction).trim()) {
    return { ok: false, error: 'instruction is required' };
  }

  const key = lookupKey(toolName, instruction, context?.workspaceId);
  const earlier = recentLookups.get(key);
  const wantsFresh = RERUN_WORDS.test(context?.userMessage || '');
  if (earlier && !wantsFresh && Date.now() - earlier.at < LOOKUP_REUSE_MS) {
    const minutes = Math.max(1, Math.round((Date.now() - earlier.at) / 60000));
    return {
      ...earlier.summary,
      reused: true,
      note: `This lookup already ran ${minutes} min ago in this conversation - this is that result, not a new check. ` +
        'Answer from it. If the user wants a fresh check they can say "recheck".',
    };
  }

  const results = await orchestrator.submitGoal(instruction, {
    departmentKey: department,
    history: context?.history || [],
    workspaceId: context?.workspaceId || null,
  });

  const first = results[0];
  if (context?.collectedTaskIds && first?.id) context.collectedTaskIds.push(first.id);
  const summary = summariseTask(first);
  if (summary.ok && summary.status === 'done' && REUSABLE_AGENTS.has(summary.agent)) {
    for (const [k, v] of recentLookups) if (Date.now() - v.at >= LOOKUP_REUSE_MS) recentLookups.delete(k);
    recentLookups.set(key, { at: Date.now(), summary });
  }
  return summary;
}

async function listPendingApprovals(context = {}) {
  const tasks = await memory.listTasks({ workspaceId: context.workspaceId || null });
  const pending = tasks
    .filter((t) => t.status === 'pending_approval')
    .slice(0, 20)
    .map((t) => ({ task_id: t.id, agent: t.agent, instruction: t.instruction, created_at: t.created_at }));
  return { count: pending.length, pending };
}

async function checkTaskResult(input, context = {}) {
  const task = await memory.getTask(input?.task_id);
  // A task from another workspace is reported as not found, never leaked.
  const foreign = task && context.workspaceId && task.workspace_id && task.workspace_id !== context.workspaceId;
  if (!task || foreign) return { ok: false, error: `task not found: ${input?.task_id}` };
  return summariseTask(task);
}

const HANDLERS = {
  run_sales_task: runDepartmentTask,
  run_marketing_task: runDepartmentTask,
  run_support_task: runDepartmentTask,
  run_strategy_task: runDepartmentTask,
  run_development_task: runDepartmentTask,
  list_pending_approvals: (_name, _input, context) => listPendingApprovals(context),
  check_task_result: (_name, input, context) => checkTaskResult(input, context),
  open_whatsapp_chat: (_name, input, context) => require('./openChat').openWhatsappChat(input, context),
};

async function invoke(toolName, input, context) {
  const readTools = require('./readTools');
  // Read-only lookups never reach the orchestrator; they handle their own errors.
  if (readTools.isReadTool(toolName)) return readTools.runReadTool(toolName, input, context);
  const handler = HANDLERS[toolName];
  if (!handler) return { ok: false, error: `unknown tool: ${toolName}` };
  try {
    return await handler(toolName, input, context);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { invoke };
