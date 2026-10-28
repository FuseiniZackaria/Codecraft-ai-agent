const memory = require('../../memory');
const config = require('../../config');
const { canSeeLegacy, rowVisible } = require('../workspaceContext');
const { agentMeta, sections } = require('../../config/agentSections');

/**
 * READ-ONLY tools for the assistant (Ian): look things up and summarise.
 *
 * Rules (enforced by tests/assistant-read-tools.test.js, which scans this
 * file for write calls):
 *   - only store reads (list/get) - no insert/update/delete/upsert, no
 *     sends, no orchestrator, no Composio, no approvals
 *   - every read is scoped to context.workspaceId and bounded by a limit
 *   - every result goes through redact() - no tokens, keys, passwords,
 *     credential blobs or full phone numbers
 *   - long text is cut and flagged with truncated: true
 *   - inputs are validated; failures come back as a short friendly error
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class ReadToolError extends Error {}

function clampInt(value, def, max, min = 1) {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function oneOf(value, allowed, label) {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim().toLowerCase();
  if (!allowed.includes(v)) throw new ReadToolError(`${label} must be one of: ${allowed.join(', ')}.`);
  return v;
}

function isoOrNull(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ReadToolError(`${label} must be a date/time like 2026-10-28T09:00:00Z.`);
  return d.toISOString();
}

/** Cuts text to `max` chars; the caller flags `truncated` when it did. */
function cut(text, max) {
  const s = text == null ? '' : String(text);
  return s.length > max ? { text: `${s.slice(0, max)}…`, cut: true } : { text: s, cut: false };
}

const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|apikey|authorization|auth[_-]?header|cookie|session|credential|private[_-]?key|refresh|access[_-]?key|client[_-]?secret|signature|^enc$|^iv$|^tag$|encrypted|webhook_url|verify)/i;
const PHONE_KEY = /(phone|whatsapp_to|whatsapp_from|from_number|to_number|msisdn)/i;

function maskPhone(s) {
  const digits = String(s).replace(/\D/g, '');
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : '•••';
}

function scrubString(s) {
  return String(s)
    .replace(/eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, '[hidden token]')
    .replace(/Bearer\s+[\w.~+/-]+=*/gi, 'Bearer [hidden]')
    .replace(/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, '[hidden key]')
    .replace(/\b(?:ghp|gho|ghs|ghu|github_pat|whsec)_[A-Za-z0-9_]{16,}/g, '[hidden key]')
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[hidden key]')
    .replace(/\bAIza[0-9A-Za-z_-]{30,}/g, '[hidden key]')
    .replace(/\bya29\.[0-9A-Za-z_.-]{20,}/g, '[hidden key]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[hidden key]')
    .replace(/\b\d{8,10}:[\w-]{30,}\b/g, '[hidden bot token]')
    .replace(/([?&](?:token|key|api_key|apikey|access_token|secret|sig|signature|code)=)[^&\s"']+/gi, '$1[hidden]')
    .replace(/(\/webhooks\/[\w/-]*?\/)[\w-]{16,}/g, '$1[hidden]')
    // Phone numbers, but never digits that are part of an id or date (UUID blocks, timestamps).
    .replace(/(?<![\w-])\+?\d[\d\s().-]{7,}\d(?![\w-])/g, (m) => {
      const n = m.replace(/\D/g, '').length;
      return n >= 9 && n <= 15 && !/^\d{4}-\d{2}-\d{2}/.test(m) ? maskPhone(m) : m;
    });
}

/** Deep copy with secrets removed and phone numbers masked. */
function redact(value, depth = 0) {
  if (depth > 8) return '[nested data hidden]';
  if (value == null) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) { out[k] = '[hidden]'; continue; }
    if (PHONE_KEY.test(k) && v != null && typeof v !== 'object') { out[k] = maskPhone(v); continue; }
    out[k] = redact(v, depth + 1);
  }
  return out;
}

function departmentOf(agent) {
  return agentMeta[agent]?.section || 'other';
}
const DEPARTMENTS = [...sections.map((s) => s.key), 'other'];

const DONE_STATES = new Set(['done', 'failed', 'rejected', 'cancelled', 'skipped']);
const TASK_STATUSES = ['pending', 'running', 'pending_approval', 'done', 'failed', 'rejected'];

function requireWorkspace(context) {
  if (!context?.workspaceId) throw new ReadToolError('No workspace is selected, so there is nothing to look up.');
  return context.workspaceId;
}

// ---------------------------------------------------------------------------
// 1. Console / audit log
// ---------------------------------------------------------------------------

function levelOf(entry) {
  const text = `${entry.action || ''} ${entry.target || ''}`;
  if (entry.metadata?.error || /fail|error|exception|crash/i.test(text)) return 'error';
  if (/block|reject|denied|approval_required|warn|skip|cap|timeout|retry/i.test(text)) return 'warn';
  return 'info';
}

async function getConsoleLogs(input = {}, context = {}) {
  const workspaceId = requireWorkspace(context);
  const level = oneOf(input.level, ['error', 'warn', 'info'], 'level');
  const limit = clampInt(input.limit, 50, 200);
  const taskId = input.task_id ? String(input.task_id).trim().slice(0, 100) : null;
  let since = isoOrNull(input.since, 'since');
  const until = isoOrNull(input.until, 'until');
  if (!since && input.since_hours !== undefined) {
    since = new Date(Date.now() - clampInt(input.since_hours, 24, 720) * 3600000).toISOString();
  }

  // Level isn't a column, so read the max window and filter here.
  const rows = await memory.getAuditLog(level ? 200 : limit, { workspaceId, taskId, since, until });
  let truncated = false;
  const entries = rows
    .map((e) => ({ ...e, level: levelOf(e) }))
    .filter((e) => !level || e.level === level)
    .slice(-limit)
    .reverse()
    .map((e) => {
      const { taskId: _t, ...meta } = e.metadata || {};
      const detail = Object.keys(meta).length ? cut(JSON.stringify(redact(meta)), 300) : { text: '', cut: false };
      const target = cut(redact(e.target), 200);
      if (detail.cut || target.cut) truncated = true;
      return {
        at: e.at, level: e.level, actor: e.actor, action: e.action, target: target.text,
        task_id: e.taskId || null, ...(detail.text ? { detail: detail.text } : {}),
      };
    });
  return {
    ok: true, count: entries.length, newest_first: true, entries,
    ...(truncated ? { truncated: true, note: 'Some long fields were cut.' } : {}),
  };
}

// ---------------------------------------------------------------------------
// 2 + 3. Tasks
// ---------------------------------------------------------------------------

function taskRow(t) {
  const title = cut(t.instruction, 140);
  return {
    id: t.id,
    title: title.text,
    status: t.status,
    agent: t.agent,
    department: departmentOf(t.agent),
    created_at: t.created_at,
    finished_at: DONE_STATES.has(t.status) ? t.updated_at || null : null,
    ...(t.status === 'failed' && t.result?.error ? { error: cut(redact(t.result.error), 200).text } : {}),
    _cut: title.cut,
  };
}

async function getTasks(input = {}, context = {}) {
  const workspaceId = requireWorkspace(context);
  const statuses = input.status
    ? [].concat(input.status).map((s) => oneOf(s, TASK_STATUSES, 'status'))
    : null;
  const department = oneOf(input.department, DEPARTMENTS, 'department');
  const limit = clampInt(input.limit, 25, 100);
  const since = input.since_hours !== undefined
    ? new Date(Date.now() - clampInt(input.since_hours, 24, 720) * 3600000).toISOString()
    : null;

  // Department isn't a column (it comes from the agent), so read a little
  // more when filtering by it - still bounded.
  const rows = await memory.listTasks({
    workspaceId, lite: true, limit: department ? Math.min(limit * 4, 200) : limit,
    ...(statuses ? { status: statuses } : {}), ...(since ? { since } : {}),
  });
  const tasks = rows
    .map(taskRow)
    .filter((t) => !department || t.department === department)
    .slice(0, limit);
  const truncated = tasks.some((t) => t._cut);
  tasks.forEach((t) => delete t._cut);
  const byStatus = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  return {
    ok: true, count: tasks.length, by_status: byStatus, newest_first: true, tasks,
    ...(tasks.length === limit ? { note: `Showing the newest ${limit}; there may be more.` } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
}

function stepText(step) {
  if (typeof step === 'string') return step;
  if (step?.error) return `error: ${step.error}`;
  return step?.text || step?.summary || (step?.type ? `${step.type} step` : JSON.stringify(step));
}

async function getTaskDetails(input = {}, context = {}) {
  const workspaceId = requireWorkspace(context);
  const id = String(input.task_id || '').trim();
  if (!id || id.length > 100) throw new ReadToolError('task_id is required.');
  const task = await memory.getTask(id);
  if (!task || !rowVisible(task, workspaceId, await canSeeLegacy(workspaceId))) {
    return { ok: false, error: `No task with id ${id} in this workspace.` };
  }
  let truncated = false;
  const out = taskRow(task);
  truncated = out._cut;
  delete out._cut;
  const full = cut(redact(task.instruction), 1000);
  out.instruction = full.text;
  truncated = truncated || full.cut;

  const result = task.result;
  if (Array.isArray(result)) {
    out.steps = result.slice(0, 10).map((s, i) => {
      const t = cut(redact(stepText(s)), 400);
      truncated = truncated || t.cut;
      return { step: i + 1, ...(s?.error ? { failed: true } : {}), text: t.text };
    });
    if (result.length > 10) { out.more_steps = result.length - 10; truncated = true; }
    const last = [...result].reverse().find((s) => s?.text);
    if (last) {
      const summary = cut(redact(last.text), 1500);
      out.result_summary = summary.text;
      truncated = truncated || summary.cut;
    }
  } else if (typeof result === 'string' || result?.text) {
    const summary = cut(redact(typeof result === 'string' ? result : result.text), 1500);
    out.result_summary = summary.text;
    truncated = truncated || summary.cut;
  }
  if (task.status === 'failed') out.error = cut(redact(result?.error || 'The task failed without an error message.'), 500).text;
  if (task.status === 'pending_approval') {
    out.waiting_for_approval = true;
    out.note = 'Waiting for the user to approve or reject on the Tasks page.';
  }
  return { ok: true, task: out, ...(truncated ? { truncated: true } : {}) };
}

// ---------------------------------------------------------------------------
// 4. Workflows
// ---------------------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeSchedule(w) {
  const type = w.scheduleType || w.schedule_type;
  if (type === 'interval') return `every ${w.intervalMinutes || w.interval_minutes} min`;
  if (type === 'daily') {
    const days = w.daysOfWeek || w.days_of_week;
    return `daily at ${w.dailyTime || w.daily_time}${days?.length ? ` on ${days.map((d) => DAYS[d]).join(', ')}` : ''}`;
  }
  if (type === 'folder_watch') return 'when a new video appears in a watched folder';
  return type || 'manual only';
}

async function getWorkflows(input = {}, context = {}) {
  const workspaceId = requireWorkspace(context);
  const runsLimit = clampInt(input.runs_limit, 10, 25, 0);

  const [scheduled, definitions] = await Promise.all([
    memory.listWorkflows({ workspaceId, limit: 50 }),
    memory.listWorkflowDefinitions({ workspaceId, lite: true, limit: 50 }),
  ]);
  const ids = definitions.map((d) => d.id);
  const runs = ids.length
    ? await memory.listWorkflowRuns(null, { workflowIds: ids, lite: true, limit: 100 })
    : [];
  const nameById = Object.fromEntries(definitions.map((d) => [d.id, d.name]));
  const lastRunById = {};
  for (const r of runs) if (!lastRunById[r.workflowId]) lastRunById[r.workflowId] = r; // newest first

  const workflows = [
    ...scheduled.map((w) => ({
      name: w.name, kind: 'scheduled goal', what_it_does: cut(redact(w.goal), 150).text,
      schedule: describeSchedule(w), enabled: !!w.enabled, last_run_at: w.lastRunAt || null,
      last_run_result: null, // scheduled goals record the run time only; the task it created has the result
    })),
    ...definitions.map((d) => {
      const last = lastRunById[d.id];
      return {
        name: d.name, kind: 'workflow', schedule: describeSchedule(d), enabled: !!d.enabled,
        last_run_at: last?.startedAt || d.lastRunAt || null,
        last_run_result: last ? last.status : null,
        ...(last?.status === 'failed' && last.error ? { last_error: cut(redact(last.error), 200).text } : {}),
      };
    }),
  ];
  const out = { ok: true, count: workflows.length, enabled: workflows.filter((w) => w.enabled).length, workflows };
  if (runsLimit > 0) {
    out.recent_runs = runs.slice(0, runsLimit).map((r) => ({
      workflow: nameById[r.workflowId] || 'unknown', status: r.status,
      started_at: r.startedAt, finished_at: r.completedAt || null,
      ...(r.error ? { error: cut(redact(r.error), 200).text } : {}),
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Analytics
// ---------------------------------------------------------------------------

async function getAnalytics(input = {}, context = {}) {
  const workspaceId = requireWorkspace(context);
  const sinceDays = clampInt(input.since_days, 30, 90);
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const TASK_CAP = 1000;

  const [tasks, auditLog, defs] = await Promise.all([
    memory.listTasks({ workspaceId, lite: true, since, limit: TASK_CAP }),
    memory.getAuditLog(2000, { workspaceId, since }),
    memory.listWorkflowDefinitions({ workspaceId, lite: true, limit: 200 }),
  ]);
  const runs = defs.length
    ? await memory.listWorkflowRuns(null, { workflowIds: defs.map((d) => d.id), lite: true, since, limit: 1000 })
    : [];
  const s = require('../analytics').summarize({ tasks, auditLog, workflowRuns: runs, workflowDefs: defs, sinceDays, workspaceId });

  const tasksByAgent = {};
  for (const t of tasks) tasksByAgent[t.agent] = (tasksByAgent[t.agent] || 0) + 1;
  const daily = await require('./usage').getDaily(memory, workspaceId);
  const cap = Number(config.assistant.dailyUsdCap) || 0;
  const round = (n) => Math.round(n * 100) / 100;

  return {
    ok: true,
    period_days: sinceDays,
    tasks: {
      total: s.totalTasks,
      succeeded: s.tasksByStatus.done || 0,
      failed: s.tasksByStatus.failed || 0,
      by_status: s.tasksByStatus,
      success_rate_percent: s.successRate == null ? null : Math.round(s.successRate * 100),
      avg_duration_seconds: s.avgDurationMs == null ? null : Math.round(s.avgDurationMs / 1000),
      per_day: s.tasksPerDay.slice(-31),
      ...(tasks.length >= TASK_CAP ? { note: `Counted the newest ${TASK_CAP} tasks only.` } : {}),
    },
    agent_usage: Object.entries(tasksByAgent)
      .sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([agent, count]) => ({ agent, department: departmentOf(agent), tasks: count, cost_usd: round(s.costByAgent[agent] || 0) })),
    ai_cost: { total_usd: round(s.totalCost), llm_calls: s.totalLlmCalls },
    workflow_runs: { total: s.totalWorkflowRuns, by_status: s.runsByStatus },
    assistant_usage_today: {
      day: daily.day,
      used_usd: round(daily.usd),
      cap_usd: cap > 0 ? cap : null,
      percent_used: cap > 0 ? Math.min(100, Math.round((daily.usd / cap) * 100)) : null,
      note: cap > 0 ? 'The cap resets daily (UTC).' : 'No daily cap is set.',
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Plugins + skills
// ---------------------------------------------------------------------------

async function getInstalledPlugins(_input = {}, _context = {}) {
  const registry = require('../../tools/ToolRegistry');
  const byPlugin = {};
  for (const name of registry.list().slice(0, 500)) {
    const [plugin, action] = name.split('.');
    if (!action) continue;
    const tool = registry.tools.get(name);
    if (!byPlugin[plugin]) byPlugin[plugin] = { actions: [], needs_approval: [] };
    byPlugin[plugin].actions.push(action);
    if (tool?.irreversible) byPlugin[plugin].needs_approval.push(action);
  }
  const plugins = Object.entries(byPlugin).sort(([a], [b]) => a.localeCompare(b)).map(([name, p]) => ({
    name,
    description: `${p.actions.length} action${p.actions.length === 1 ? '' : 's'}: ${p.actions.join(', ')}`,
    enabled: true,
    ...(p.needs_approval.length ? { actions_needing_approval: p.needs_approval } : {}),
  }));
  return { ok: true, count: plugins.length, note: 'Plugins are built into the app and always on; the same set is available to every workspace.', plugins };
}

async function getInstalledSkills(_input = {}, context = {}) {
  const workspaceId = requireWorkspace(context);
  const rows = await memory.listSkills({ workspaceId, limit: 100 });
  let truncated = false;
  const skills = rows.map((s) => {
    const d = cut(redact(s.description || ''), 200);
    truncated = truncated || d.cut;
    return { name: s.name, version: s.version || null, description: d.text, enabled: s.status === 'enabled' || s.status === 'active', status: s.status };
  });
  return { ok: true, count: skills.length, enabled: skills.filter((s) => s.enabled).length, skills, ...(truncated ? { truncated: true } : {}) };
}

// ---------------------------------------------------------------------------
// 7. Chats - grouped into conversations by 30+ minute gaps
// ---------------------------------------------------------------------------

const GAP_MS = 30 * 60 * 1000;

function groupConversations(messages) {
  const groups = [];
  let current = null;
  for (const m of messages) {
    const t = new Date(m.created_at || m.at || 0).getTime();
    if (!current || t - current.lastAt > GAP_MS) {
      current = { id: new Date(t).toISOString(), messages: [], lastAt: t };
      groups.push(current);
    }
    current.messages.push(m);
    current.lastAt = t;
  }
  return groups;
}

async function getRecentChats(input = {}, context = {}) {
  const workspaceId = requireWorkspace(context);
  const rows = await memory.listChatMessages(300, { workspaceId }); // oldest first
  const groups = groupConversations(rows);

  if (input.conversation_id) {
    const id = isoOrNull(input.conversation_id, 'conversation_id');
    const group = groups.find((g) => g.id === id);
    if (!group) return { ok: false, error: 'That conversation was not found in recent chats.' };
    let truncated = group.messages.length > 30;
    const messages = group.messages.slice(-30).map((m) => {
      const c = cut(redact(m.content), 500);
      truncated = truncated || c.cut;
      return { role: m.role, at: m.created_at, content: c.text };
    });
    return { ok: true, conversation_id: id, message_count: group.messages.length, messages, ...(truncated ? { truncated: true, note: 'Long messages were cut; only the last 30 messages are shown.' } : {}) };
  }

  const limit = clampInt(input.limit, 5, 10);
  const now = Date.now();
  const conversations = groups.slice(-limit).reverse().map((g, i) => {
    const firstUser = g.messages.find((m) => m.role === 'user');
    const lastReply = [...g.messages].reverse().find((m) => m.role === 'assistant');
    return {
      conversation_id: g.id,
      title: cut(redact(firstUser?.content || '(no user message)'), 80).text,
      started_at: g.id,
      last_message_at: new Date(g.lastAt).toISOString(),
      message_count: g.messages.length,
      snippet: cut(redact(lastReply?.content || ''), 160).text,
      ...(i === 0 && now - g.lastAt < GAP_MS ? { is_current_conversation: true } : {}),
    };
  });
  return { ok: true, count: conversations.length, newest_first: true, conversations, note: 'Conversations are split wherever there was a 30-minute gap. Titles and snippets are shortened.' };
}

// ---------------------------------------------------------------------------
// 8. Connection status - a pure read of workspace_connections
// ---------------------------------------------------------------------------

const CONNECTION_PROVIDERS = ['whatsapp', 'telegram', 'gmail', 'googlecalendar', 'github', 'googlesheets'];
const PROVIDER_LABEL = { whatsapp: 'WhatsApp', telegram: 'Telegram', gmail: 'Gmail', googlecalendar: 'Google Calendar', github: 'GitHub', googlesheets: 'Google Sheets' };

function accountLabel(conn) {
  const meta = conn.provider_meta || {};
  if (conn.provider === 'whatsapp') {
    const phone = meta.display_phone || meta.whatsapp_from || meta.phone_number;
    return phone ? `number ending ${maskPhone(phone)}` : null;
  }
  if (conn.provider === 'telegram') return meta.bot_username ? `@${meta.bot_username}` : null;
  if (conn.provider === 'googlesheets') return meta.sheet_title ? `sheet "${meta.sheet_title}"` : (conn.connected_email || null);
  return conn.connected_email || null;
}

async function getConnectionStatus(_input = {}, context = {}) {
  const workspaceId = requireWorkspace(context);
  const [rows, recent] = await Promise.all([
    memory.listWorkspaceConnections(workspaceId),
    memory.getAuditLog(200, { workspaceId }),
  ]);
  const connections = CONNECTION_PROVIDERS.map((provider) => {
    const conn = rows.find((r) => r.provider === provider);
    let status = 'not_connected';
    if (conn?.status === 'connected') status = 'connected';
    else if (conn && conn.status && conn.status !== 'disconnected') status = 'needs_reconnect';
    const hit = [...recent].reverse().find((e) => new RegExp(provider, 'i').test(`${e.actor} ${e.target}`));
    return {
      name: PROVIDER_LABEL[provider],
      status,
      account: conn && status !== 'not_connected' ? accountLabel(conn) : null,
      last_active: hit?.at || null,
      last_changed: conn?.updated_at || null,
    };
  });
  return {
    ok: true, connections,
    note: 'Status is what CodeCraft has stored; an expired sign-in that has not been noticed yet can still show as connected. last_active is the newest matching activity-log entry, if any.',
  };
}

// ---------------------------------------------------------------------------
// Definitions + dispatch
// ---------------------------------------------------------------------------

const READ_TOOLS = [
  {
    name: 'get_console_logs',
    description: 'READ-ONLY. Recent console/activity-log entries for this workspace (newest first). Use for "what failed", "what happened", errors and warnings.',
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['error', 'warn', 'info'] },
        task_id: { type: 'string', description: 'Only entries for this task.' },
        since_hours: { type: 'integer', description: 'Only the last N hours (1-720).' },
        since: { type: 'string', description: 'ISO start time.' },
        until: { type: 'string', description: 'ISO end time.' },
        limit: { type: 'integer', description: 'Default 50, max 200.' },
      },
    },
    run: getConsoleLogs,
  },
  {
    name: 'get_tasks',
    description: 'READ-ONLY. Recent tasks (newest first) with status, agent, department and times. Filter by status and/or department.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'array', items: { type: 'string', enum: TASK_STATUSES }, description: 'One or more statuses.' },
        department: { type: 'string', enum: DEPARTMENTS },
        since_hours: { type: 'integer', description: 'Only tasks created in the last N hours (1-720).' },
        limit: { type: 'integer', description: 'Default 25, max 100.' },
      },
    },
    run: getTasks,
  },
  {
    name: 'get_task_details',
    description: 'READ-ONLY. One task by id: status, steps, result summary, and the error if it failed.',
    input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    run: getTaskDetails,
  },
  {
    name: 'get_workflows',
    description: 'READ-ONLY. Saved and scheduled workflows: schedule, enabled/paused, last run time and result, plus recent runs.',
    input_schema: { type: 'object', properties: { runs_limit: { type: 'integer', description: 'Recent runs to include, 0-25 (default 10).' } } },
    run: getWorkflows,
  },
  {
    name: 'get_analytics',
    description: 'READ-ONLY. Summary numbers: tasks per day, success vs failure, agent usage, AI cost, workflow runs, and how much of today\'s assistant usage cap is used.',
    input_schema: { type: 'object', properties: { since_days: { type: 'integer', description: 'Period in days, 1-90 (default 30).' } } },
    run: getAnalytics,
  },
  {
    name: 'get_installed_plugins',
    description: 'READ-ONLY. Built-in plugins with their actions and enabled state.',
    input_schema: { type: 'object', properties: {} },
    run: getInstalledPlugins,
  },
  {
    name: 'get_installed_skills',
    description: 'READ-ONLY. Skills installed in this workspace with description and enabled/disabled state.',
    input_schema: { type: 'object', properties: {} },
    run: getInstalledSkills,
  },
  {
    name: 'get_recent_chats',
    description: 'READ-ONLY. Recent chat conversations (title, time, snippet), or one conversation\'s messages when conversation_id is given.',
    input_schema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string', description: 'From a previous get_recent_chats result.' },
        limit: { type: 'integer', description: 'Conversations to list, default 5, max 10.' },
      },
    },
    run: getRecentChats,
  },
  {
    name: 'get_connection_status',
    description: 'READ-ONLY. Whether WhatsApp, Telegram, Gmail, Google Calendar, GitHub and Google Sheets are connected, the account label, and when each was last active.',
    input_schema: { type: 'object', properties: {} },
    run: getConnectionStatus,
  },
];

const BY_NAME = Object.fromEntries(READ_TOOLS.map((t) => [t.name, t]));

function isReadTool(name) {
  return !!BY_NAME[name];
}

function definitions() {
  return READ_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

async function runReadTool(name, input, context) {
  const tool = BY_NAME[name];
  if (!tool) return { ok: false, error: `unknown tool: ${name}` };
  try {
    return redact(await tool.run(input || {}, context || {}));
  } catch (err) {
    if (err instanceof ReadToolError) return { ok: false, error: err.message };
    console.warn(`[assistant.readTools] ${name} failed: ${err.message}`);
    return { ok: false, error: `Couldn't look that up right now (${name.replace(/_/g, ' ')} is unavailable). Try again in a moment.` };
  }
}

module.exports = { definitions, isReadTool, runReadTool, redact, READ_TOOL_NAMES: Object.keys(BY_NAME) };
