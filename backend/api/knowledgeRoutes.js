const express = require('express');
const store = require('../core/knowledge/store');
const qa = require('../core/knowledge/qa');
const { requireKnowledgeEditor } = require('../core/workspaceAccess');

/**
 * /api/knowledge - the caller's workspace knowledge base.
 *
 *   GET    /qa          all Q&A entries (newest first)
 *   POST   /qa          add one        { question, answer, enabled? }
 *   PATCH  /qa/:id      change one     { question?, answer?, enabled? }
 *   DELETE /qa/:id      delete one
 *
 * Every change is used by the WhatsApp agent from its next reply (nothing is cached).
 */

const router = express.Router();
router.use(requireKnowledgeEditor);

function fail(res, err) {
  if (err.code === 'INVALID') return res.status(400).json({ error: 'Please fix this and try again.', details: err.details });
  if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
  if (err.code === 'MIGRATION_MISSING') return res.status(503).json({ error: err.message, migrationMissing: true });
  console.warn(`[knowledge] ${err.message}`);
  return res.status(500).json({ error: err.message });
}

router.get('/qa', async (req, res) => {
  try {
    const entries = await store.listQa(req.user.workspaceId);
    res.json({ entries, limits: qa.LIMITS });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/qa', async (req, res) => {
  try {
    const entry = await qa.create(req.user.workspaceId, req.body || {}, req.user);
    res.status(201).json({ entry });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/qa/:id', async (req, res) => {
  try {
    const entry = await qa.update(req.user.workspaceId, req.params.id, req.body || {});
    res.json({ entry });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/qa/:id', async (req, res) => {
  try {
    await qa.remove(req.user.workspaceId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
