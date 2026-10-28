const express = require('express');
const clientTracker = require('../core/clientTracker');

/**
 * /api/client-tracker - the Gmail + Sheets + Calendar client tracker for the
 * caller's own workspace (see core/clientTracker.js).
 */
const router = express.Router();

function handler(fn) {
  return async (req, res) => {
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved for your account.' });
    try {
      res.json(await fn(wsId, req.body || {}, req));
    } catch (err) {
      const status = err instanceof clientTracker.TrackerError || err?.code === 'SHEETS_NOT_CONFIGURED' || err?.code === 'WORKSPACE_CONNECTION_MISSING' ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  };
}

router.get('/status', handler((ws) => clientTracker.status(ws)));
router.get('/activity', handler((ws, _b, req) => clientTracker.recentActivity(ws, Math.min(Number(req.query.limit) || 50, 200))));

router.post('/setup', handler((ws, body) => clientTracker.setup(ws, body)));
router.post('/settings', handler((ws, body) => clientTracker.saveSettings(ws, body)));

// body: { leads: [{ name, email, company, highValue, notes }] }
router.post('/import', handler((ws, body) => {
  if (!Array.isArray(body.leads) || !body.leads.length) throw new clientTracker.TrackerError('Send at least one lead.');
  if (body.leads.length > 500) throw new clientTracker.TrackerError('Import at most 500 leads at a time.');
  return clientTracker.importLeads(ws, body.leads);
}));

// body: { subject, body, limit }
router.post('/outreach', handler((ws, body) => clientTracker.sendOutreach(ws, body)));
router.post('/check-replies', handler((ws) => clientTracker.checkReplies(ws)));
router.post('/follow-ups', handler((ws) => clientTracker.runFollowUps(ws)));

module.exports = router;
