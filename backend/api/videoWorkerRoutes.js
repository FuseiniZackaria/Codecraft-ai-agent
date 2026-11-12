const crypto = require('crypto');
const express = require('express');
const jobs = require('../core/video/jobs');
const storage = require('../core/video/storage');
const brandKit = require('../core/video/brandKit');

/**
 * /api/video-worker - for the video editor worker only (your laptop now, a
 * Render background worker later - same code). It proves itself with
 * VIDEO_WORKER_TOKEN (Authorization: Bearer ...). It never gets R2 keys or
 * the database key: only short-lived signed links for the one job it claimed.
 */
const router = express.Router();

function tokenOk(req) {
  const expected = process.env.VIDEO_WORKER_TOKEN || '';
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || expected.length < 24 || !got) return false;
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

router.use((req, res, next) => {
  if (!process.env.VIDEO_WORKER_TOKEN) return res.status(503).json({ error: 'VIDEO_WORKER_TOKEN is not set on the backend.' });
  if (!tokenOk(req)) return res.status(401).json({ error: 'Wrong worker token.' });
  usageContext.runAutomated(next); // no logged-in person; a job's own routes switch to its owner below
});

const workerIdOf = (req) => String(req.body?.workerId || '').replace(/[^\w.-]/g, '').slice(0, 80) || 'worker';

// AI usage on a job (its plan, its post caption) counts for the person who started that video;
// anything else the worker does with no job is "automated".
const usageContext = require('../core/usage/context');
router.param('id', (req, res, next, id) => {
  jobs.getForWorker(id, workerIdOf(req))
    .then((job) => (job?.user_id ? usageContext.runForUser({ id: job.user_id, email: null }, next) : usageContext.runAutomated(next)))
    .catch(() => usageContext.runAutomated(next));
});

router.post('/heartbeat', (req, res) => {
  jobs.heartbeat(workerIdOf(req), req.body || {});
  res.json({ ok: true, storageConfigured: storage.isConfigured() });
});

/** The next job, with signed links to its original and the business's brand kit. */
router.post('/claim', async (req, res) => {
  const workerId = workerIdOf(req);
  jobs.heartbeat(workerId, { ...(req.body || {}), busy: false });
  if (!storage.isConfigured()) return res.json({ job: null, reason: 'storage_not_configured' });
  try {
    const job = await jobs.claimNext(workerId);
    if (!job) return res.json({ job: null });
    const kit = await brandKit.get(job.workspace_id).catch(() => null);
    const link = (key, seconds = 6 * 3600) => storage.downloadUrl(key, { seconds });
    const profile = await require('../core/businessProfile').getProfile(job.workspace_id).catch(() => null);
    // Files saved while planning (transcript, screenshots), for the render.
    const files = {};
    for (const name of (Array.isArray(job.plan?.files) ? job.plan.files : []).slice(0, 300)) {
      files[name] = await link(storage.keys.work(job.workspace_id, job.id, name)).catch(() => null);
    }
    // Website login (sealed for this worker): handed over once, then forgotten here.
    const loginVault = require('../core/video/loginVault');
    const login = job.mode === 'website' && job.phase !== 'render' && job.request?.needsLogin ? loginVault.take(job.id) : null;
    res.json({
      job: {
        id: job.id,
        kind: job.kind,
        mode: job.mode || 'auto',
        phase: job.phase || 'edit',
        request: job.request || {},
        plan: job.plan || null,
        files,
        login,
        attempts: job.attempts,
        originalName: job.original_name,
        originalBytes: job.original_bytes,
        originalUrl: job.original_key ? await link(job.original_key) : null,
        answers: job.answers || {},
        businessName: profile?.business_name || null,
        brand: kit ? {
          colors: kit.colors, font: kit.font, voice: kit.voice,
          logoUrl: kit.logo_key ? await link(kit.logo_key).catch(() => null) : null,
          broll: await Promise.all(kit.broll.map(async (b) => ({ name: b.name, kind: b.kind, url: await link(b.key).catch(() => null) }))),
        } : null,
      },
    });
  } catch (err) {
    console.warn(`[video-worker] claim failed: ${err.message}`);
    res.status(err.code === 'MIGRATION_MISSING' ? 503 : 500).json({ error: err.message });
  }
});

async function ownJob(req, res) {
  const job = await jobs.getForWorker(req.params.id, workerIdOf(req)).catch(() => null);
  if (!job) res.status(404).json({ error: 'Not your job.' });
  return job;
}

router.post('/jobs/:id/progress', async (req, res) => {
  jobs.heartbeat(workerIdOf(req), { ...(req.body || {}), busy: true });
  try {
    const r = await jobs.progress(req.params.id, workerIdOf(req), req.body || {});
    if (r.error) return res.status(404).json({ error: 'Not your job.' });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Retakes, pauses and parts from the word-level transcript (rules + AI). */
router.post('/jobs/:id/plan', async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const { words, duration } = req.body || {};
  if (!Array.isArray(words)) return res.status(400).json({ error: 'words required' });
  try {
    const { selectProvider } = require('../core/router');
    const ask = async (system, prompt) => (await selectProvider({}).complete({ system, prompt, maxTokens: 1500 })).text;
    res.json(await require('../core/video/cutPlanner').plan({ words, duration: Number(duration) || null }, { ask }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** "Edit my video my way": the description + transcript -> a plan to approve (Claude Sonnet; the automatic edit if the AI doesn't answer). */
router.post('/jobs/:id/plan-custom', async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const { words, duration, images, reference } = req.body || {};
  if (!Array.isArray(words)) return res.status(400).json({ error: 'words required' });
  const planner = require('../core/video/editPlanner');
  try {
    res.json(await planner.customPlan({
      words, duration: Number(duration) || null, description: job.request?.description || '', answers: job.answers || {},
      images: Array.isArray(images) ? images.map(String).slice(0, 60) : [], reference: reference && typeof reference === 'object' ? reference : null,
    }));
  } catch (err) {
    if (/No speech/.test(err.message)) return res.status(400).json({ error: err.message });
    console.warn(`[video] custom plan for ${job.id}: AI failed (${err.message}) - offering the automatic edit`);
    res.json(await planner.fallbackCustom({ words, duration: Number(duration) || null }));
  }
});

/** "Make a video of my website": the explored pages -> scenes + voiceover to approve. */
router.post('/jobs/:id/plan-website', async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const { pages, thumbs, notes } = req.body || {};
  if (!Array.isArray(pages)) return res.status(400).json({ error: 'pages required' });
  try {
    const profile = await require('../core/businessProfile').getProfile(job.workspace_id).catch(() => null);
    const kit = await brandKit.get(job.workspace_id).catch(() => null);
    res.json(await require('../core/video/editPlanner').websitePlan({
      pages: pages.slice(0, 20), thumbs: Array.isArray(thumbs) ? thumbs.slice(0, 10) : [], notes: Array.isArray(notes) ? notes.map(String).slice(0, 10) : [],
      description: job.request?.description || '', answers: job.answers || {}, businessName: profile?.business_name || null, brandVoice: kit?.voice || null,
    }));
  } catch (err) {
    res.status(502).json({ error: `Planning the video didn't work: ${err.message}` });
  }
});

/** The plan is ready: it waits for the business's approval. { plan, files: [names saved under work/] } */
router.post('/jobs/:id/submit-plan', async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const plan = req.body?.plan;
  if (!plan || typeof plan !== 'object' || !['custom', 'website'].includes(plan.kind)) return res.status(400).json({ error: 'plan required' });
  if (JSON.stringify(plan).length > 900000) return res.status(400).json({ error: 'plan too large' });
  const files = (Array.isArray(req.body?.files) ? req.body.files : []).map((f) => storage.safeName(String(f), 'file')).slice(0, 300);
  try {
    const r = await jobs.submitPlan(job.id, workerIdOf(req), { ...plan, files, notes: (Array.isArray(req.body?.notes) ? req.body.notes : []).map((n) => String(n).slice(0, 400)).slice(0, 20) });
    res.json(r?.canceled ? { canceled: true } : { ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Where to upload one file: { name, contentType, area: 'output' | 'work' } -> { url, key } (inside this job's folder only). */
router.post('/jobs/:id/upload', async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const contentType = /^video\/mp4$|^image\/(png|jpeg)$|^application\/json$|^audio\/wav$/.test(req.body?.contentType || '') ? req.body.contentType : 'video/mp4';
  try {
    const key = req.body?.area === 'work'
      ? storage.keys.work(job.workspace_id, job.id, req.body?.name || 'file')
      : storage.keys.output(job.workspace_id, job.id, req.body?.name || 'video.mp4');
    res.json({ key, url: await storage.uploadUrl(key, contentType), contentType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Finished: { outputs: [{ key, name, format, width, height, bytes, duration, part, partTitle, role }], notes, parts: [{ title, transcript }], stats } */
router.post('/jobs/:id/complete', async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const prefix = storage.keys.jobPrefix(job.workspace_id, job.id);
  const body = req.body || {};
  const outputs = (Array.isArray(body.outputs) ? body.outputs : []).filter((o) => typeof o.key === 'string' && o.key.startsWith(`${prefix}output/`));
  if (!outputs.length) return res.status(400).json({ error: 'No finished files.' });
  try {
    for (const o of outputs) o.bytes = (await storage.sizeOf(o.key)) || 0; // what R2 really holds
    const result = {
      outputs,
      notes: (Array.isArray(body.notes) ? body.notes : []).map((n) => String(n).slice(0, 400)).slice(0, 30),
      parts: (Array.isArray(body.parts) ? body.parts : []).map((p) => ({ title: p.title ? String(p.title).slice(0, 80) : null, transcript: String(p.transcript || '').slice(0, 20000) })),
      stats: body.stats && typeof body.stats === 'object' ? body.stats : {},
      post: null,
    };
    const done = await jobs.complete(job.id, workerIdOf(req), result);
    if (done?.canceled) return res.json({ canceled: true });
    res.json({ ok: true });
    // Working files (transcript, website screenshots - possibly of logged-in pages) go at once.
    if (job.mode && job.mode !== 'auto') storage.deletePrefix(`${prefix}work/`).catch((err) => console.warn(`[video] work files of ${job.id} not deleted: ${err.message}`));
    // The post caption and hashtags, written afterwards so the video is available at once.
    if (job.kind !== 'test_clip') {
      writePost(job, result).catch(async (err) => {
        console.warn(`[video] post text for ${job.id} failed: ${err.message}`);
        await jobs.setPostText(job.id, job.workspace_id, { parts: [], note: "The post caption couldn't be written this time (the AI service didn't answer). The video itself is ready." }).catch(() => {});
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function writePost(job, result) {
  const kit = await brandKit.get(job.workspace_id).catch(() => null);
  const parts = result.parts.length ? result.parts : [{ title: null, transcript: '' }];
  const posts = [];
  for (const p of parts) {
    if (!p.transcript) continue;
    posts.push({ title: p.title, ...(await require('../core/video/postText').write({ workspaceId: job.workspace_id, transcript: p.transcript, answers: job.answers || {}, brandVoice: kit?.voice || null, partTitle: p.title })) });
  }
  await jobs.setPostText(job.id, job.workspace_id, posts.length ? { parts: posts } : { parts: [], note: 'No speech in the video, so no caption was written.' });
}

router.post('/jobs/:id/fail', async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  await jobs.fail(job.id, workerIdOf(req), req.body?.error).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
module.exports._tokenOk = tokenOk;
