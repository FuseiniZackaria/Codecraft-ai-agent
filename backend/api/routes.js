const express = require('express');
const orchestrator = require('../core/orchestrator');
const memory = require('../memory');
const toolRegistry = require('../tools/ToolRegistry');
const composio = require('../core/composio');
const chat = require('../core/chat');
const { runAssistant } = require('../core/assistant');
const assistantUsage = require('../core/assistant/usage');
const whatsappProvider = require('../core/whatsappProvider');
const telegramProvider = require('../core/telegramProvider');
const { agents } = require('../agents/registry');
const { availableProviders } = require('../core/router');
const { goalSubmissionLimiter } = require('../core/rateLimits');
const config = require('../config');
const { sections: agentSectionList, agentMeta, backgroundJobs: agentBgJobs } = require('../config/agentSections');
const router = express.Router();

function resolveConfigPath(dotPath) {
  return dotPath.split('.').reduce((obj, key) => obj?.[key], config) ?? 0;
}


// Lightweight connectivity check - actually calls a cheap Gmail action rather
// than guessing at Composio's connection-listing API shape, so "connected"
// here means "a real call actually works", not just "a key is present".
let gmailStatusCache = { at: 0, value: null };
const GMAIL_STATUS_TTL_MS = 60_000;

router.get('/composio/gmail/status', async (req, res) => {
  if (Date.now() - gmailStatusCache.at < GMAIL_STATUS_TTL_MS && gmailStatusCache.value) {
    return res.json(gmailStatusCache.value);
  }
  try {
    await composio.execute('GMAIL_FETCH_EMAILS', { max_results: 1 }, 'gmail');
    gmailStatusCache = { at: Date.now(), value: { connected: true } };
    res.json(gmailStatusCache.value);
  } catch (err) {
    gmailStatusCache = { at: Date.now(), value: { connected: false, error: err.message } };
    res.json(gmailStatusCache.value);
  }
});

// Conversational chat - only creates a task for genuinely actionable messages
router.post('/chat', async (req, res) => {
  try {
    const { message, history, attachments } = req.body;
    if (!message && !(attachments || []).length) {
      return res.status(400).json({ error: '"message" or an attachment is required' });
    }
    const result = await chat.handleMessage(message || '', history || [], attachments || []);

    // Persist both sides server-side, so chat history survives a refresh or
    // a different device/browser. Fire-and-forget - a persistence hiccup
    // should never break the actual chat response the user is waiting on.
    const attachmentNames = (attachments || []).map((a) => a.name).filter(Boolean);
    const userContent =
      message || (attachmentNames.length ? `Sent ${attachmentNames.length === 1 ? attachmentNames[0] : `${attachmentNames.length} files`}` : '');
    const workspaceId = req.user?.workspaceId || null;
    memory
      .addChatMessage({ role: 'user', content: userContent, attachmentNames, workspace_id: workspaceId }, { workspaceId })
      .catch((err) => console.warn(`[chat] failed to persist user message: ${err.message}`));
    memory
      .addChatMessage({ role: 'assistant', content: result.reply, taskId: result.task?.id || null, workspace_id: workspaceId }, { workspaceId })
      .catch((err) => console.warn(`[chat] failed to persist assistant reply: ${err.message}`));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Phase 2.3: scopes a list result to the current workspace at the route
// layer. Returns rows unfiltered if the request has no workspaceId
// (pre-migration behavior, or legacy service-key callers), AND if a row
// has no workspace_id (unstamped backfill rows). Phase 2.3b will remove
// the second escape once every row is stamped.
function scopeByWorkspace(rows, req) {
  const ws = req.user?.workspaceId;
  if (!ws) return rows;
  return (rows || []).filter((r) => !r.workspace_id || r.workspace_id === ws);
}

router.get('/chat/history', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const rows = await memory.listChatMessages(limit, { workspaceId: req.user?.workspaceId || null });
    res.json(scopeByWorkspace(rows, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Streaming conversational endpoint - one SSE connection per message, closed
// on done. Falls back to the keyword-classifier chat.handleMessage() if the
// Assistant can't run (daily cap hit, no API key, SDK error).
router.post('/chat/stream', async (req, res) => {
  const { message, scope, attachments, voice } = req.body || {};
  if (!message && !(attachments || []).length) {
    return res.status(400).json({ error: '"message" or an attachment is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
  };

  // Attachments still go through the legacy multimodal path - the Assistant
  // module doesn't accept files yet. Short-circuit here, return as one chunk.
  if ((attachments || []).length) {
    try {
      const result = await chat.handleMessage(message || '', [], attachments);
      send({ type: 'text_delta', text: result.reply });
      await persistTurn(message || '', attachments, result.reply, result.task?.id || null, req.user?.workspaceId || null);
      send({ type: 'done', task_ids: result.task ? [result.task.id] : [], fallback: 'attachments' });
    } catch (err) {
      send({ type: 'error', error: err.message });
    }
    return res.end();
  }

  let accumulated = '';
  const tasksForTurn = [];

  try {
    const result = await runAssistant({
      message,
      scope: scope || null,
      voice: !!voice,
      onEvent: (event) => {
        if (event.type === 'text_delta') accumulated += event.text;
        if (event.type === 'tool_end' && event.result?.task_id) tasksForTurn.push(event.result.task_id);
        send(event);
      },
    });
    accumulated = accumulated || result.reply;
    for (const id of result.taskIds) if (!tasksForTurn.includes(id)) tasksForTurn.push(id);
    await persistTurn(message, [], accumulated, tasksForTurn[0] || null, req.user?.workspaceId || null);
    send({ type: 'done', task_ids: tasksForTurn, usage: result.usage });
  } catch (err) {
    const isCap = err.code === 'DAILY_CAP_REACHED';
    if (isCap) {
      send({ type: 'notice', text: 'Daily spend cap reached - using fallback routing until midnight.' });
    } else {
      console.warn(`[chat/stream] assistant failed, falling back: ${err.message}`);
      send({ type: 'notice', text: 'Smart mode unavailable - using fallback routing.' });
    }
    try {
      const history = await memory.listChatMessages(30);
      const historyForFallback = history
        .filter((m) => m.content && m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }));
      const result = await chat.handleMessage(message, historyForFallback, []);
      send({ type: 'text_delta', text: result.reply });
      await persistTurn(message, [], result.reply, result.task?.id || null, req.user?.workspaceId || null);
      send({ type: 'done', task_ids: result.task ? [result.task.id] : [], fallback: isCap ? 'daily_cap' : 'assistant_error' });
    } catch (fallbackErr) {
      send({ type: 'error', error: fallbackErr.message });
    }
  }

  res.end();
});

async function persistTurn(userMessage, attachments, assistantReply, taskId, workspaceId = null) {
  const attachmentNames = (attachments || []).map((a) => a.name).filter(Boolean);
  const userContent =
    userMessage || (attachmentNames.length ? `Sent ${attachmentNames.length === 1 ? attachmentNames[0] : `${attachmentNames.length} files`}` : '');
  try {
    await memory.addChatMessage({ role: 'user', content: userContent, attachmentNames, workspace_id: workspaceId }, { workspaceId });
    await memory.addChatMessage({ role: 'assistant', content: assistantReply, taskId, workspace_id: workspaceId }, { workspaceId });
  } catch (err) {
    console.warn(`[chat/stream] persist failed: ${err.message}`);
  }
}

router.get('/assistant/usage', async (req, res) => {
  try {
    res.json(await assistantUsage.getDaily(memory));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let redditStatusCache = { at: 0, value: null };

router.get('/composio/reddit/status', async (req, res) => {
  if (Date.now() - redditStatusCache.at < GMAIL_STATUS_TTL_MS && redditStatusCache.value) {
    return res.json(redditStatusCache.value);
  }
  const result = await composio.checkConnectionStatus('reddit');
  redditStatusCache = { at: Date.now(), value: result };
  res.json(result);
});

let githubStatusCache = { at: 0, value: null };

router.get('/composio/github/status', async (req, res) => {
  if (Date.now() - githubStatusCache.at < GMAIL_STATUS_TTL_MS && githubStatusCache.value) {
    return res.json(githubStatusCache.value);
  }
  const result = await composio.checkConnectionStatus('github');
  githubStatusCache = { at: Date.now(), value: result };
  res.json(result);
});

let googlecalendarStatusCache = { at: 0, value: null };

router.get('/composio/googlecalendar/status', async (req, res) => {
  if (Date.now() - googlecalendarStatusCache.at < GMAIL_STATUS_TTL_MS && googlecalendarStatusCache.value) {
    return res.json(googlecalendarStatusCache.value);
  }
  const result = await composio.checkConnectionStatus('googlecalendar');
  googlecalendarStatusCache = { at: Date.now(), value: result };
  res.json(result);
});

let whatsappStatusCache = { at: 0, value: null };

router.get('/composio/whatsapp/status', async (req, res) => {
  if (Date.now() - whatsappStatusCache.at < GMAIL_STATUS_TTL_MS && whatsappStatusCache.value) {
    return res.json(whatsappStatusCache.value);
  }
  const result = await whatsappProvider.checkStatus();
  whatsappStatusCache = { at: Date.now(), value: result };
  res.json(result);
});

let telegramStatusCache = { at: 0, value: null };

router.get('/composio/telegram/status', async (req, res) => {
  if (Date.now() - telegramStatusCache.at < GMAIL_STATUS_TTL_MS && telegramStatusCache.value) {
    return res.json(telegramStatusCache.value);
  }
  try {
    const result = await telegramProvider.checkStatus();
    telegramStatusCache = { at: Date.now(), value: result };
    res.json(result);
  } catch (err) {
    const result = { connected: false, error: err.message };
    telegramStatusCache = { at: Date.now(), value: result };
    res.json(result);
  }
});

// Submit a new high-level goal
router.post('/orchestrator/goal', goalSubmissionLimiter, async (req, res) => {
  const { goal, payload, overrideProvider, departmentKey, agentKey } = req.body;
  if (!goal) return res.status(400).json({ error: '"goal" is required' });

  try {
    const results = await orchestrator.submitGoal(goal, {
      payload, overrideProvider, departmentKey, agentKey,
      workspaceId: req.user?.workspaceId || null,
    });
    if (results[0]?._mismatch) return res.json(results[0]);
    res.json({ tasks: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Task status
router.get('/tasks/:id', async (req, res) => {
  try {
    const task = await memory.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tasks', async (req, res) => {
  try {
    const rows = await memory.listTasks({ workspaceId: req.user?.workspaceId || null });
    res.json(scopeByWorkspace(rows, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    await memory.deleteTask(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  console.log(`[bulk-delete] Deleting ${ids.length} tasks`);
  let deleted = 0;
  const errors = [];
  for (const id of ids) {
    try {
      await memory.deleteTask(id);
      deleted++;
    } catch (err) {
      errors.push({ id, error: err.message });
    }
  }
  console.log(`[bulk-delete] Done: ${deleted} deleted, ${errors.length} failed${errors.length ? ` — first error: ${errors[0].error}` : ''}`);
  res.json({ deleted, failed: errors.length, errors });
});

router.post('/tasks/mark-all-read', async (req, res) => {
  try {
    await memory.markAllTasksRead();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit a pending_approval task's payload before approving (e.g. tweak a
// drafted email body). Only allowed while still pending approval.
router.patch('/tasks/:id/payload', async (req, res) => {
  try {
    const task = await memory.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'pending_approval') {
      return res.status(400).json({ error: `Task is not pending approval (status: ${task.status})` });
    }
    const updated = await memory.updateTask(req.params.id, {
      payload: { ...task.payload, ...req.body.payload },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve / reject a pending_approval task
router.post('/tasks/:id/approve', async (req, res) => {
  try {
    const task = await orchestrator.approveTask(req.params.id, { workspaceId: req.user?.workspaceId || null });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/tasks/:id/reject', async (req, res) => {
  try {
    const task = await orchestrator.rejectTask(req.params.id, { workspaceId: req.user?.workspaceId || null });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Agents — returns sections metadata alongside the agent list so the
// frontend can render grouped sections without its own copy of the config.
router.get('/agents', (req, res) => {
  const agentList = Object.entries(agents).map(([key, agent]) => {
    const meta = agentMeta[key] || { section: 'other', description: '' };
    const jobs = agentBgJobs
      .filter((j) => j.agentKey === key)
      .map((j) => {
        const intervalMinutes = resolveConfigPath(j.configKey);
        return { name: j.name, intervalMinutes, enabled: intervalMinutes > 0 };
      });
    return {
      key,
      role: agent.role,
      goals: agent.goals,
      tools: agent.tools,
      section: meta.section,
      description: meta.description,
      backgroundJobs: jobs,
    };
  });
  res.json({ sections: agentSectionList, agents: agentList });
});

// Dashboard summary
router.get('/dashboard/summary', async (req, res) => {
  try {
    const allTasks = await memory.listTasks({ workspaceId: req.user?.workspaceId || null });
    const tasks = scopeByWorkspace(allTasks, req);
    const auditLog = await memory.getAuditLog(undefined, { workspaceId: req.user?.workspaceId || null });
    res.json({
      activeAgents: Object.keys(agents).length,
      installedTools: toolRegistry.list(),
      availableProviders: availableProviders(),
      tasks: {
        total: tasks.length,
        pending_approval: tasks.filter((t) => t.status === 'pending_approval').length,
        done: tasks.filter((t) => t.status === 'done').length,
        failed: tasks.filter((t) => t.status === 'failed').length,
      },
           auditLog: auditLog.slice(-20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;


