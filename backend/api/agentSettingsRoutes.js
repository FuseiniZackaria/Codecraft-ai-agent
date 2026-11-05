const express = require('express');
const agentSettings = require('../core/knowledge/agentSettings');
const store = require('../core/knowledge/store');
const { requireKnowledgeEditor } = require('../core/workspaceAccess');

/**
 * /api/agent-settings - the WhatsApp agent's instructions, example replies and
 * hold reply for the caller's workspace, with version history.
 *
 *   GET    /                         what's in use now + the version list
 *   GET    /versions/:id             one old version in full (to preview)
 *   POST   /                         save as a new version
 *   POST   /versions/:id/restore     roll back (saves the old one as the newest)
 */

const router = express.Router();
router.use(requireKnowledgeEditor);

function fail(res, err) {
  if (err.code === 'INVALID') return res.status(400).json({ error: 'Please fix these and save again.', details: err.details });
  if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
  if (err.code === 'MIGRATION_MISSING') return res.status(503).json({ error: err.message, migrationMissing: true });
  console.warn(`[agent-settings] ${err.message}`);
  return res.status(500).json({ error: err.message });
}

router.get('/', async (req, res) => {
  const workspaceId = req.user.workspaceId;
  try {
    const versions = await store.listVersions(workspaceId);
    agentSettings.invalidate(workspaceId); // always show the freshest
    const active = await agentSettings.getActive(workspaceId);
    res.json({
      active: {
        source: active.source, // saved | default | file
        version: active.version,
        agent_name: active.agentName,
        instructions: active.instructions,
        examples: active.examples,
        hold_reply: active.holdReply,
      },
      versions,
      limits: agentSettings.LIMITS,
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/versions/:id', async (req, res) => {
  try {
    const v = await store.getVersion(req.user.workspaceId, req.params.id);
    if (!v) return res.status(404).json({ error: 'That version was not found.' });
    res.json({ version: v });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const saved = await agentSettings.save(req.user.workspaceId, req.body || {}, req.user);
    res.json({ saved: { id: saved.id, version: saved.version } });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/versions/:id/restore', async (req, res) => {
  try {
    const saved = await agentSettings.restore(req.user.workspaceId, req.params.id, req.user);
    res.json({ saved: { id: saved.id, version: saved.version } });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
