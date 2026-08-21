const express = require('express');
const orchestrator = require('../core/orchestrator');
const memory = require('../memory');
const toolRegistry = require('../tools/ToolRegistry');
const composio = require('../core/composio');
const chat = require('../core/chat');
const whatsappProvider = require('../core/whatsappProvider');
const { agents } = require('../agents/registry');
const { availableProviders } = require('../core/router');

const router = express.Router();

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
    memory
      .addChatMessage({ role: 'user', content: userContent, attachmentNames })
      .catch((err) => console.warn(`[chat] failed to persist user message: ${err.message}`));
    memory
      .addChatMessage({ role: 'assistant', content: result.reply, taskId: result.task?.id || null })
      .catch((err) => console.warn(`[chat] failed to persist assistant reply: ${err.message}`));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/chat/history', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    res.json(await memory.listChatMessages(limit));
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

let whatsappStatusCache = { at: 0, value: null };

router.get('/composio/whatsapp/status', async (req, res) => {
  if (Date.now() - whatsappStatusCache.at < GMAIL_STATUS_TTL_MS && whatsappStatusCache.value) {
    return res.json(whatsappStatusCache.value);
  }
  const result = await whatsappProvider.checkStatus();
  whatsappStatusCache = { at: Date.now(), value: result };
  res.json(result);
});

// Submit a new high-level goal
router.post('/orchestrator/goal', async (req, res) => {
  const { goal, payload, overrideProvider } = req.body;
  if (!goal) return res.status(400).json({ error: '"goal" is required' });

  try {
    const results = await orchestrator.submitGoal(goal, { payload, overrideProvider });
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
    res.json(await memory.listTasks());
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
    const task = await orchestrator.approveTask(req.params.id);
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/tasks/:id/reject', async (req, res) => {
  try {
    const task = await orchestrator.rejectTask(req.params.id);
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Agents
router.get('/agents', (req, res) => {
  res.json(Object.entries(agents).map(([key, agent]) => ({
    key,
    role: agent.role,
    goals: agent.goals,
    tools: agent.tools,
  })));
});

// Dashboard summary
router.get('/dashboard/summary', async (req, res) => {
  try {
    const tasks = await memory.listTasks();
    const auditLog = await memory.getAuditLog();
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
