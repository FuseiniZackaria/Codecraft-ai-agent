const express = require('express');
const rateLimit = require('express-rate-limit');
const devices = require('../core/computerOperator/devices');
const { OP_NAMES } = require('../core/computerOperator/ops');

/**
 * /api/computer-helper - called by the Computer Helper running on a person's
 * PC (no browser login). It signs in with its own secret
 * (Authorization: Bearer ...), which only ever reaches that one computer's
 * jobs. Connecting needs the one-time code from the "My computer" page.
 */
const router = express.Router();

// Wrong-code guessing: a few tries a minute per address (codes also expire in 10 minutes).
const pairLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many tries - wait a minute and try again.' },
});
// Each helper checks in about every 25 s; this only stops a runaway loop.
const helperLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this helper.' },
});

const LONG_POLL_MS = Number(process.env.COMPUTER_HELPER_POLL_MS) || 25_000;

router.post('/pair', pairLimiter, async (req, res) => {
  try {
    const { code, name, roots, apps } = req.body || {};
    if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Enter the connect code from the "My computer" page.' });
    const out = await devices.redeemPairing({ code, name, roots, apps });
    if (!out) return res.status(400).json({ error: 'That code is wrong or has expired - get a new one on the "My computer" page.' });
    res.json({ token: out.token, deviceId: out.deviceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function requireDevice(req, res, next) {
  try {
    const m = String(req.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
    const device = m ? await devices.deviceByToken(m[1]) : null;
    if (!device) return res.status(401).json({ error: 'This computer is not connected (or was disconnected).' });
    req.device = device;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Check in + wait for the next action (long poll). Reports what this PC shares.
router.post('/next', helperLimiter, requireDevice, async (req, res) => {
  try {
    const { name, roots, apps } = req.body || {};
    let device = await devices.heartbeat(req.device, { name, roots, apps });
    if (device.paused) {
      await devices.waitForWork(device.id, Math.min(LONG_POLL_MS, 10_000));
      return res.json({ job: null, paused: true });
    }
    let job = await devices.claimNext(device.id);
    if (!job) {
      await devices.waitForWork(device.id, LONG_POLL_MS);
      device = await devices.getDevice(device.id);
      if (!device || device.status !== 'active') return res.status(401).json({ error: 'This computer was disconnected.' });
      if (device.paused) return res.json({ job: null, paused: true });
      job = await devices.claimNext(device.id);
    }
    if (job && !OP_NAMES.includes(job.op)) {
      await devices.finishJob(device.id, job.id, { ok: false, error: 'Unknown action' });
      job = null;
    }
    res.json({ job: job ? { id: job.id, op: job.op, args: job.args, summary: job.summary } : null, paused: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:id/result', helperLimiter, requireDevice, async (req, res) => {
  try {
    const { ok, result, error } = req.body || {};
    const job = await devices.finishJob(req.device.id, req.params.id, { ok: !!ok, result, error });
    if (!job) return res.status(404).json({ error: 'No such running job for this computer.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
