const express = require('express');
const config = require('../config');
const mcpClient = require('../core/mcpClient');
const mcpSessions = require('../core/mcpSessions');
const mcpToolBridge = require('../core/mcpToolBridge');

const router = express.Router();

// Same shared secret as /api/browser - this endpoint makes the backend
// connect to and invoke tools on arbitrary external servers on the
// caller's behalf. With CORS wide open, leaving this unauthenticated
// would let any website's own JS trigger that, not just this app.
function requireToken(req, res, next) {
  const configured = config.browserExtension.token;
  if (!configured) {
    return res.status(503).json({ error: 'BROWSER_EXTENSION_TOKEN is not set on the server.' });
  }
  if (req.headers['x-codecraft-token'] !== configured) {
    return res.status(401).json({ error: 'Invalid or missing X-CodeCraft-Token header.' });
  }
  next();
}

router.use(requireToken);

router.post('/connect', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A string "url" field is required.' });
  }
  try {
    const session = await mcpClient.connect(url);
    const tools = await mcpClient.listTools(session);
    mcpSessions.save(url, session, tools);
    // Registered as real ToolRegistry entries so agents can reference them
    // by name - but always irreversible, so referencing one defers to
    // human approval rather than running it, same as gmail.sendEmail.
    const registeredToolNames = mcpToolBridge.registerMCPTools(url, tools);
    res.json({ ok: true, serverInfo: session.serverInfo, negotiatedProtocolVersion: session.negotiatedProtocolVersion, tools, registeredToolNames });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, code: err.code || null });
  }
});

router.post('/call', async (req, res) => {
  const { url, tool, args } = req.body || {};
  if (!url || typeof url !== 'string' || !tool || typeof tool !== 'string') {
    return res.status(400).json({ error: 'Both "url" and "tool" string fields are required.' });
  }
  try {
    let entry = mcpSessions.get(url);
    if (!entry) {
      // No existing session - connect fresh rather than failing, so a
      // caller doesn't have to always call /connect first.
      const session = await mcpClient.connect(url);
      const tools = await mcpClient.listTools(session);
      mcpSessions.save(url, session, tools);
      entry = mcpSessions.get(url);
    }
    const result = await mcpClient.callTool(entry.session, tool, args || {});
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, code: err.code || null });
  }
});

router.get('/sessions', (req, res) => {
  res.json({ sessions: mcpSessions.list() });
});

module.exports = router;
