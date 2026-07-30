const express = require('express');
const { Installer, InstallError } = require('../core/installer/Installer');
const { SkillManager, SkillNotFoundError } = require('../core/installer/SkillManager');
const { Registry } = require('../core/installer/Registry');
const { detectSource } = require('../core/installer/SourceDetector');
const { Downloader } = require('../core/installer/Downloader');
const { SignatureVerifier } = require('../core/installer/SignatureVerifier');
const { Manifest } = require('../core/installer/Manifest');

const router = express.Router();
const installer = new Installer();
const skillManager = new SkillManager();
const registry = new Registry();

function handleError(res, err) {
  const status = err instanceof SkillNotFoundError ? 404 : err instanceof InstallError ? 400 : 500;
  res.status(status).json({ error: err.message });
}

// --- Registry / marketplace browsing (declared before /:id so "registry" never matches as an id) ---

router.get('/registry/search', (req, res) => {
  try {
    res.json(registry.search(req.query.q || ''));
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/registry/categories', (req, res) => {
  try {
    res.json(registry.listCategories());
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/registry/:id', (req, res) => {
  try {
    res.json(registry.getDetails(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

// --- Preview a package's manifest/permissions BEFORE installing ---

router.post('/preview', async (req, res) => {
  try {
    const { source: sourceInput } = req.body;
    if (!sourceInput) return res.status(400).json({ error: '"source" is required' });

    const source = detectSource(sourceInput);
    const downloader = new Downloader();
    const packageDir =
      source.type === 'registry' ? await downloader.fetch(registry.resolveSource(source.id)) : await downloader.fetch(source);

    const verifier = new SignatureVerifier();
    const checksum = verifier.computeChecksum(packageDir);
    const manifest = Manifest.load(packageDir);

    res.json({ manifest, checksum, source });
  } catch (err) {
    handleError(res, err);
  }
});

// --- Install ---

router.post('/install', async (req, res) => {
  try {
    const { source, approvedPermissions } = req.body;
    if (!source) return res.status(400).json({ error: '"source" is required' });
    const result = await installer.install(source, { approvedPermissions: approvedPermissions || [] });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// --- Installed skills list/search/info ---

router.get('/', async (req, res) => {
  try {
    res.json(await skillManager.list());
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/search', async (req, res) => {
  try {
    res.json(await skillManager.search(req.query.q || ''));
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    res.json(await skillManager.info(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

// --- Lifecycle operations ---

router.post('/:id/enable', async (req, res) => {
  try {
    res.json(await skillManager.enable(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/disable', async (req, res) => {
  try {
    res.json(await skillManager.disable(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    res.json(await skillManager.remove(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/reinstall', async (req, res) => {
  try {
    res.json(await skillManager.reinstall(req.params.id, req.body.approvedPermissions || []));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/repair', async (req, res) => {
  try {
    res.json(await skillManager.repair(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/update-check', async (req, res) => {
  try {
    res.json(await skillManager.checkForUpdate(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/update', async (req, res) => {
  try {
    res.json(await skillManager.update(req.params.id, req.body.approvedPermissions || []));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/backup', async (req, res) => {
  try {
    res.json(await skillManager.backup(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/restore', async (req, res) => {
  try {
    res.json(await skillManager.restore(req.params.id, req.body.backupPath));
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
