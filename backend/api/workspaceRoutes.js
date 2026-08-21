const express = require('express');
const fs = require('fs');
const path = require('path');
const toolRegistry = require('../tools/ToolRegistry');
const { resolveProjectRoot, resolveSafePath, PROJECT_ID_PATTERN } = require('../plugins/filesystem/workspaceSafety');

const router = express.Router();

function validateProjectId(req, res, next) {
  if (!PROJECT_ID_PATTERN.test(req.params.projectId || '')) {
    return res.status(400).json({ error: 'Invalid project id' });
  }
  next();
}

router.get('/:projectId/files', validateProjectId, async (req, res) => {
  try {
    const result = await toolRegistry.call('filesystem.listFiles', { projectId: req.params.projectId }, { role: 'api' });
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Serves a single file directly (e.g. a generated image) - for viewing/
// embedding inline, unlike /download below which bundles the whole project.
router.get('/:projectId/file/*', validateProjectId, (req, res) => {
  try {
    const relativePath = req.params[0];
    const target = resolveSafePath(req.params.projectId, relativePath);
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(target);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/:projectId/download', validateProjectId, async (req, res) => {
  try {
    const projectRoot = resolveProjectRoot(req.params.projectId);
    const zipPath = path.join(projectRoot, '..', `${req.params.projectId}.zip`);

    // Build the zip on demand if it doesn't exist yet (e.g. requested before
    // the agent's reflect() step ran, or after a restart).
    if (!fs.existsSync(zipPath)) {
      await toolRegistry.call('filesystem.zipProject', { projectId: req.params.projectId }, { role: 'api' });
    }

    res.download(zipPath, `${req.params.projectId}.zip`);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
