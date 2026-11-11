const express = require('express');
const jobs = require('../core/video/jobs');
const storage = require('../core/video/storage');
const brandKit = require('../core/video/brandKit');

/**
 * /api/video - Content Studio's video editor, for signed-in admins. Every
 * route works on the caller's own business (req.user.workspaceId) only.
 *
 * Flow: POST /jobs (name, size, the 3 answers) -> the browser uploads straight
 * to R2 with the returned link -> POST /jobs/:id/uploaded -> the worker picks
 * it up -> GET /jobs/:id shows progress, then download links.
 */
const router = express.Router();

const VIDEO_TYPES = /^video\/(mp4|quicktime|x-m4v|webm|x-matroska|3gpp|mpeg|avi|x-msvideo)$/;
const IMAGE_TYPES = /^image\/(png|jpeg|webp|svg\+xml)$/;

function ws(req, res) {
  const id = req.user?.workspaceId || null;
  if (!id) res.status(400).json({ error: 'No business workspace for this account.' });
  return id;
}

function fail(res, err) {
  const status = err.code === 'MIGRATION_MISSING' || err.code === 'STORAGE_NOT_CONFIGURED' ? 503 : 500;
  console.warn(`[video] ${err.message}`);
  res.status(status).json({ error: err.message, code: err.code || null });
}

/** Signed links for a finished job's videos (fresh each time; they last an hour). */
async function withLinks(job) {
  if (!job) return job;
  const out = { ...job };
  delete out.original_key;
  if (job.status === 'done' && Array.isArray(job.result?.outputs) && storage.isConfigured()) {
    out.result = { ...job.result };
    out.result.outputs = await Promise.all(job.result.outputs.map(async (o) => ({
      ...o,
      key: undefined,
      downloadUrl: await storage.downloadUrl(o.key, { downloadName: o.name }).catch(() => null),
      previewUrl: await storage.downloadUrl(o.key, { downloadName: o.name, inline: true }).catch(() => null),
    })));
  }
  return out;
}

router.get('/status', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  try {
    const kit = await brandKit.get(id).catch(() => null);
    res.json({
      storageConfigured: storage.isConfigured(),
      worker: jobs.workerStatus(),
      usage: storage.isConfigured() ? { bytes: await jobs.bytesUsed(id).catch(() => 0), limitBytes: jobs.PER_BUSINESS_LIMIT_BYTES } : null,
      keepDays: jobs.KEEP_DAYS,
      maxUploadBytes: jobs.MAX_UPLOAD_BYTES,
      brandKitReady: !!kit?.ready,
      fonts: brandKit.FONTS,
      stages: jobs.STAGES,
    });
  } catch (err) {
    fail(res, err);
  }
});

/** App owner only: a real upload/read/delete round trip that says which R2 setting is wrong (never shows keys). */
router.post('/storage-check', async (req, res) => {
  const ownerEmail = (process.env.APP_OWNER_EMAIL || require('../config').applicant?.email || '').toLowerCase();
  if (!ownerEmail || String(req.user?.email || '').toLowerCase() !== ownerEmail) return res.status(403).json({ error: 'Only the app owner can check storage.' });
  try {
    res.json(await storage.selfCheck());
  } catch (err) {
    res.status(500).json({ ok: false, problem: err.message });
  }
});

router.get('/jobs', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  try {
    const list = (await jobs.list(id)).filter((j) => j.status !== 'expired');
    res.json(await Promise.all(list.map(withLinks)));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/jobs/:id', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  try {
    const job = await jobs.get(req.params.id, id);
    if (!job) return res.status(404).json({ error: 'Video not found' });
    res.json(await withLinks(job));
  } catch (err) {
    fail(res, err);
  }
});

/** Start: { name, bytes, contentType, platform, cta, style, both_formats } -> { job, uploadUrl } */
router.post('/jobs', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  const { name, bytes, contentType } = req.body || {};
  const { answers, fieldErrors } = jobs.validateAnswers(req.body || {});
  if (!name) fieldErrors.file = 'Choose a video to upload.';
  else if (!VIDEO_TYPES.test(String(contentType || ''))) fieldErrors.file = "That doesn't look like a video file (MP4, MOV, WebM, MKV…).";
  else if (!(Number(bytes) > 0)) fieldErrors.file = 'That file is empty.';
  else if (Number(bytes) > jobs.MAX_UPLOAD_BYTES) fieldErrors.file = 'Videos can be up to 4 GB.';
  const all = Object.values(fieldErrors);
  if (all.length) return res.status(400).json({ error: all[0], fieldErrors });
  try {
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Video storage is not set up yet (R2). See docs/video-editor.md.', code: 'STORAGE_NOT_CONFIGURED' });
    if (answers.style === 'captions' && !(await brandKit.get(id)).ready) {
      return res.status(400).json({ error: 'Choose two brand colours and a font first - they are saved for every video.', fieldErrors: { brand: 'Brand colours and font needed.' } });
    }
    const problem = await jobs.storageProblem(id, bytes);
    if (problem) return res.status(400).json({ error: problem });
    const job = await jobs.create({ workspaceId: id, userId: req.user.id, originalName: storage.safeName(name), bytes, contentType, answers });
    const uploadUrl = await storage.uploadUrl(job.original_key, contentType);
    res.json({ job: await withLinks(job), uploadUrl, contentType });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/jobs/:id/uploaded', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  try {
    const { job, error } = await jobs.markUploaded(req.params.id, id);
    if (error === 'not_found') return res.status(404).json({ error: 'Video not found' });
    if (error === 'not_uploaded') return res.status(400).json({ error: "The upload didn't arrive. Please try again." });
    res.json({ job: await withLinks(job), worker: jobs.workerStatus() });
  } catch (err) {
    fail(res, err);
  }
});

/** The 7-second test clip with branded captions - no upload needed. */
router.post('/test-clip', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  try {
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Video storage is not set up yet (R2).', code: 'STORAGE_NOT_CONFIGURED' });
    const kit = await brandKit.get(id);
    if (!kit.ready) return res.status(400).json({ error: 'Choose two brand colours and a font first.' });
    const platform = ['instagram', 'tiktok', 'youtube'].includes(req.body?.platform) ? req.body.platform : 'tiktok';
    const job = await jobs.create({ workspaceId: id, userId: req.user.id, kind: 'test_clip', answers: { platform, cta: 'Follow for more', style: 'captions' } });
    res.json({ job: await withLinks(job), worker: jobs.workerStatus() });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/jobs/:id', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  try {
    if (!(await jobs.remove(req.params.id, id))) return res.status(404).json({ error: 'Video not found' });
    res.json({ deleted: true });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- brand kit ----------

async function brandView(id) {
  const kit = await brandKit.get(id);
  const link = (key) => (storage.isConfigured() && key ? storage.downloadUrl(key, { downloadName: key.split('/').pop(), inline: true }).catch(() => null) : null);
  return {
    colors: kit.colors, font: kit.font, voice: kit.voice, ready: kit.ready, fonts: brandKit.FONTS,
    logo: kit.logo_key ? { url: await link(kit.logo_key) } : null,
    broll: await Promise.all(kit.broll.map(async (b) => ({ key: b.key, name: b.name, kind: b.kind, bytes: b.bytes, url: await link(b.key) }))),
  };
}

router.get('/brand-kit', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  try { res.json(await brandView(id)); } catch (err) { fail(res, err); }
});

router.put('/brand-kit', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  const { patch, fieldErrors, errors } = brandKit.validate(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors[0], fieldErrors });
  try {
    await brandKit.save(id, patch, { userId: req.user.id });
    res.json(await brandView(id));
  } catch (err) {
    fail(res, err);
  }
});

/** Upload a logo or B-roll file: { kind: 'logo'|'broll', name, contentType, bytes } -> { uploadUrl, key } */
router.post('/brand-kit/assets', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  const { kind, name, contentType, bytes } = req.body || {};
  if (!['logo', 'broll'].includes(kind)) return res.status(400).json({ error: 'Choose a logo or a B-roll file.' });
  const isVideo = VIDEO_TYPES.test(String(contentType || ''));
  if (!IMAGE_TYPES.test(String(contentType || '')) && !(kind === 'broll' && isVideo)) {
    return res.status(400).json({ error: kind === 'logo' ? 'The logo must be a PNG, JPG, WebP or SVG image.' : 'B-roll must be an image or a video.' });
  }
  const max = isVideo ? 500 * 1024 ** 2 : 20 * 1024 ** 2;
  if (!(Number(bytes) > 0) || Number(bytes) > max) return res.status(400).json({ error: isVideo ? 'B-roll videos can be up to 500 MB.' : 'Images can be up to 20 MB.' });
  try {
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Video storage is not set up yet (R2).', code: 'STORAGE_NOT_CONFIGURED' });
    const kit = await brandKit.get(id);
    if (kind === 'broll' && kit.broll.length >= brandKit.MAX_BROLL) return res.status(400).json({ error: `The B-roll kit holds up to ${brandKit.MAX_BROLL} files - remove some first.` });
    const problem = await jobs.storageProblem(id, Number(bytes) / 2);
    if (problem) return res.status(400).json({ error: problem });
    const key = storage.keys.brand(id, name);
    res.json({ key, uploadUrl: await storage.uploadUrl(key, contentType), contentType });
  } catch (err) {
    fail(res, err);
  }
});

/** After the upload: { kind, key, name } - checked against R2, then saved in the kit. */
router.post('/brand-kit/assets/confirm', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  const { kind, key, name } = req.body || {};
  if (!storage.keys.belongsTo(id, key) || !['logo', 'broll'].includes(kind)) return res.status(400).json({ error: 'Unknown file.' });
  try {
    const size = await storage.sizeOf(key);
    if (!size) return res.status(400).json({ error: "The upload didn't arrive. Please try again." });
    const kit = await brandKit.get(id);
    if (kind === 'logo') {
      if (kit.logo_key && kit.logo_key !== key) await storage.deleteKey(kit.logo_key).catch(() => {});
      await brandKit.save(id, { logo_key: key }, { userId: req.user.id });
    } else {
      const fileKind = /\.(mp4|mov|m4v|webm|mkv)$/i.test(key) ? 'video' : 'image';
      await brandKit.save(id, { broll: [...kit.broll, { key, name: storage.safeName(name, 'b-roll'), kind: fileKind, bytes: size }] }, { userId: req.user.id });
    }
    res.json(await brandView(id));
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/brand-kit/assets', async (req, res) => {
  const id = ws(req, res);
  if (!id) return;
  const key = String(req.body?.key || req.query.key || '');
  if (!storage.keys.belongsTo(id, key)) return res.status(400).json({ error: 'Unknown file.' });
  try {
    const kit = await brandKit.get(id);
    await storage.deleteKey(key).catch(() => {});
    await brandKit.save(id, kit.logo_key === key ? { logo_key: null } : { broll: kit.broll.filter((b) => b.key !== key) }, { userId: req.user.id });
    res.json(await brandView(id));
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
