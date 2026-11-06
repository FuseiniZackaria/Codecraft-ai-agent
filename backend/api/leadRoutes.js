const express = require('express');
const store = require('../core/leads/store');
const leads = require('../core/leads');
const { requireKnowledgeEditor } = require('../core/workspaceAccess');

/**
 * /api/leads - the caller's workspace leads (Work -> Leads).
 *
 *   GET   /            WhatsApp leads + the Google Sheet's scraped leads
 *   PATCH /:id         { status, notes, name, need } - you change a lead by hand
 *   GET   /settings    follow-up + daily summary settings
 *   PUT   /settings    change them
 *   GET   /summary     what today's summary would say (preview, nothing sent)
 */

const router = express.Router();
router.use(requireKnowledgeEditor);

function fail(res, err) {
  if (err.code === 'INVALID') return res.status(400).json({ error: err.message, details: err.details || [err.message] });
  if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
  if (err.code === 'MIGRATION_MISSING') return res.status(503).json({ error: err.message, migrationMissing: true });
  console.warn(`[leads] ${err.message}`);
  return res.status(500).json({ error: err.message });
}
const ws = (req) => req.user.workspaceId;
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { fail(res, err); } };

const publicSettings = (s) => ({
  followups_enabled: s.followups_enabled, ask_before_followup: s.ask_before_followup,
  first_followup_days: s.first_followup_days, second_followup_days: s.second_followup_days,
  daily_summary: s.daily_summary, summary_hour: s.summary_hour,
});

router.get('/', wrap(async (req, res) => {
  const [page, settings] = await Promise.all([leads.listForPage(ws(req)), store.getSettings(ws(req))]);
  res.json({ ...page, settings: publicSettings(settings), statuses: leads.STATUSES, needs: leads.NEEDS });
}));

router.get('/settings', wrap(async (req, res) => res.json({ settings: publicSettings(await store.getSettings(ws(req))) })));
router.put('/settings', wrap(async (req, res) => {
  const current = await store.getSettings(ws(req));
  // Checked together with the saved values (e.g. 2nd follow-up after the 1st).
  const merged = { ...publicSettings(current), ...(req.body || {}) };
  const valid = leads.validateSettings(merged);
  res.json({ settings: publicSettings(await store.saveSettings(ws(req), valid)) });
}));

router.get('/summary', wrap(async (req, res) => res.json(await leads.buildSummary(ws(req)))));

router.patch('/:id', wrap(async (req, res) => res.json({ lead: await leads.updateByOwner(ws(req), req.params.id, req.body || {}) })));

module.exports = router;
