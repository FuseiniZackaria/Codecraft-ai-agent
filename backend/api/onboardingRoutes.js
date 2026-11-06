const express = require('express');
const onboarding = require('../core/onboarding');

/**
 * /api/onboarding - the caller's workspace setup checklist, welcome screen and tour.
 *
 *   GET  /               steps (done / skipped / not available), progress, what to show
 *   POST /welcome-seen   the welcome screen was closed
 *   POST /skip           { step, skipped }  skip a step for now (or bring it back)
 *   POST /hide           { hidden }         hide the checklist (once everything is done or skipped)
 *   POST /tour-seen      this person finished or skipped the tour
 */

const router = express.Router();
router.use((req, res, next) => {
  if (!req.user?.workspaceId) return res.status(403).json({ error: 'No workspace for this account.' });
  return next();
});

function fail(res, err) {
  if (err.code === 'INVALID') return res.status(400).json({ error: err.message, details: err.details });
  if (err.code === 'MIGRATION_MISSING') return res.status(503).json({ error: err.message, migrationMissing: true });
  console.warn(`[onboarding] ${err.message}`);
  return res.status(500).json({ error: err.message });
}
const ws = (req) => req.user.workspaceId;
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { fail(res, err); } };
const current = async (req, res) => res.json(await onboarding.status(ws(req), req.user));

router.get('/', wrap(current));
router.post('/welcome-seen', wrap(async (req, res) => { await onboarding.markWelcomeSeen(ws(req)); await current(req, res); }));
router.post('/skip', wrap(async (req, res) => { await onboarding.setSkipped(ws(req), String(req.body?.step || ''), req.body?.skipped !== false); await current(req, res); }));
router.post('/hide', wrap(async (req, res) => { await onboarding.setHidden(ws(req), req.body?.hidden !== false); await current(req, res); }));
router.post('/tour-seen', wrap(async (req, res) => { await onboarding.markTourSeen(ws(req), req.user.id); await current(req, res); }));

module.exports = router;
