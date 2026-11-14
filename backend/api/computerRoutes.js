const express = require('express');
const config = require('../config');
const devices = require('../core/computerOperator/devices');
const { buildHelper, buildWindowsLauncher } = require('../core/computerOperator/helperBundle');
const activityLog = require('../core/activityLog');

/**
 * /api/computer - the "My computer" page. Everything here is about the
 * signed-in person's OWN computer; nobody can see or control anyone else's
 * (owner's decision: own PC only).
 */
const router = express.Router();

const me = (req) => req.user?.id || null;

router.get('/', async (req, res) => {
  try {
    const list = await devices.listForUser(me(req));
    const recent = await devices.recentJobs(me(req), 30);
    res.json({ devices: list, recent, localMode: (config.computerOperator?.allowedRoots || []).length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A one-time connect code (10 minutes). Replaces any unused earlier code.
router.post('/connect', async (req, res) => {
  try {
    const out = await devices.createPairing({ userId: me(req), workspaceId: req.user?.workspaceId || null });
    await activityLog.record(req.user?.email || 'user', 'computer_connect_started', 'computer helper', { workspaceId: req.user?.workspaceId || null });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function publicServerUrl(req) {
  const fromEnv = (process.env.COMPUTER_HELPER_SERVER_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  return fromEnv || `${req.protocol}://${req.get('host')}`;
}

// The helper program (?format=windows: a double-click .cmd), as text, with this server's address (and the connect code, if given) built in.
router.get('/helper', async (req, res) => {
  try {
    const code = String(req.query.code || '').toUpperCase();
    const opts = { serverUrl: publicServerUrl(req), pairCode: code };
    // Windows: one file to double-click. Others: the plain script, run with node.
    if (req.query.format === 'windows') return res.json({ filename: 'codecraft-computer-helper.cmd', content: buildWindowsLauncher(opts) });
    res.json({ filename: 'codecraft-computer-helper.js', content: buildHelper(opts) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/devices/:id/pause', async (req, res) => {
  try {
    const d = await devices.setPaused(me(req), req.params.id, !!req.body?.paused);
    if (!d) return res.status(404).json({ error: 'Computer not found.' });
    await activityLog.record(req.user?.email || 'user', d.paused ? 'computer_paused' : 'computer_resumed', d.name, { workspaceId: req.user?.workspaceId || null });
    res.json(d);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/devices/:id', async (req, res) => {
  try {
    const ok = await devices.revoke(me(req), req.params.id);
    if (!ok) return res.status(404).json({ error: 'Computer not found.' });
    await activityLog.record(req.user?.email || 'user', 'computer_disconnected', 'computer helper', { workspaceId: req.user?.workspaceId || null });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
