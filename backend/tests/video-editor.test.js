// Content Studio video editor (backend side): the three questions; upload ->
// queue -> a worker claims it -> progress -> done with download links; the
// worker needs its token and only reaches the job it claimed; one business
// never sees another's videos or brand kit; storage limits; requeue of a
// job whose worker went quiet; retake/pause planning (rules, plus an AI that
// can't break it); the post caption and hashtags come from Content Studio's
// own prompts. Also step 0: project files belong to a business; signed file
// links (no more localhost). R2 is replaced by an in-memory stand-in.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.VIDEO_WORKER_TOKEN = 'test-worker-token-0123456789abcdef';
process.env.WORKSPACE_ENCRYPTION_KEY = 'test-encryption-key';
process.env.RENDER_EXTERNAL_URL = 'https://codecraft-backend.example.com';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const express = require('express');
const storage = require('../core/video/storage');
const jobs = require('../core/video/jobs');
const brandKit = require('../core/video/brandKit');
const cutPlanner = require('../core/video/cutPlanner');
const mockProvider = require('../core/providers/mockProvider');

// R2 stand-in: "uploads" are just recorded sizes.
const objects = new Map();
storage._useDriver({
  uploadUrl: async (key) => `https://r2.test/put/${encodeURIComponent(key)}`,
  downloadUrl: async (key, { downloadName }) => `https://r2.test/get/${encodeURIComponent(key)}?name=${downloadName || ''}`,
  sizeOf: async (key) => objects.get(key) ?? null,
  deletePrefix: async (prefix) => { let n = 0; for (const k of [...objects.keys()]) if (k.startsWith(prefix)) { objects.delete(k); n += 1; } return n; },
  deleteKey: async (key) => { objects.delete(key); },
});

const WS_A = 'aaaaaaaa-0000-0000-0000-0000000000v1';
const WS_B = 'bbbbbbbb-0000-0000-0000-0000000000v2';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/video-worker', require('../api/videoWorkerRoutes'));
  a.use('/api/video', (req, _res, next) => { req.user = { id: 'user-1', workspaceId: req.headers['x-ws'] || null, workspaceRole: 'owner' }; next(); }, require('../api/videoRoutes'));
  return a;
}

(async () => {
  const server = await new Promise((r) => { const s = app().listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const as = (ws) => ({ 'x-ws': ws });
  const worker = (path, body = {}, token = process.env.VIDEO_WORKER_TOKEN) => call('POST', `/api/video-worker${path}`, { workerId: 'laptop', ...body }, { Authorization: `Bearer ${token}` });

  // 1. The three questions and the brand kit come first.
  {
    let r = await call('POST', '/api/video/jobs', { name: 'clip.mp4', bytes: 1000, contentType: 'video/mp4' }, as(WS_A));
    assert.strictEqual(r.status, 400);
    assert(r.body.fieldErrors.platform && r.body.fieldErrors.cta && r.body.fieldErrors.style, 'all three questions are required');
    r = await call('POST', '/api/video/jobs', { name: 'clip.exe', bytes: 1000, contentType: 'application/x-msdownload', platform: 'tiktok', cta: 'Order now', style: 'clean' }, as(WS_A));
    assert(/doesn't look like a video/.test(r.body.fieldErrors.file));
    r = await call('POST', '/api/video/jobs', { name: 'clip.mp4', bytes: 1000, contentType: 'video/mp4', platform: 'tiktok', cta: 'Order now', style: 'captions' }, as(WS_A));
    assert.strictEqual(r.status, 400);
    assert(/brand colours and a font/.test(r.body.error), 'captions ask once for brand colours and a font');
    r = await call('PUT', '/api/video/brand-kit', { colors: ['#e4572e'], font: 'Comic Sans' }, as(WS_A));
    assert(r.body.fieldErrors.colors && r.body.fieldErrors.font);
    r = await call('PUT', '/api/video/brand-kit', { colors: ['#e4572e', '#1b1b1e'], font: 'Montserrat', voice: 'Warm, proud of Ghanaian food' }, as(WS_A));
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.colors, ['#E4572E', '#1B1B1E']);
    assert.strictEqual(r.body.ready, true);
    assert.strictEqual((await brandKit.get(WS_B)).ready, false, "business B doesn't see A's brand kit");
    console.log('✓ the 3 questions are required; captions ask once for 2 brand colours + a font, then they are saved per business');
  }

  // 2. Upload -> queued. The worker is offline until it checks in.
  let jobId;
  {
    let r = await call('GET', '/api/video/status', null, as(WS_A));
    assert.strictEqual(r.body.worker.online, false, 'no check-in yet: offline');
    r = await call('POST', '/api/video/jobs', { name: "Ama's Jollof Ad.MOV", bytes: 5000, contentType: 'video/quicktime', platform: 'tiktok', cta: 'Order on WhatsApp', style: 'captions' }, as(WS_A));
    assert.strictEqual(r.status, 200);
    jobId = r.body.job.id;
    assert(r.body.uploadUrl.startsWith('https://r2.test/put/'));
    assert(!('original_key' in r.body.job), 'storage paths are not sent to the browser');
    const job = jobs._mem.jobs.find((j) => j.id === jobId);
    assert(job.original_key.startsWith(`ws/${WS_A}/jobs/${jobId}/original/`), 'stored in the business\'s own folder');
    r = await call('POST', `/api/video/jobs/${jobId}/uploaded`, null, as(WS_A));
    assert.strictEqual(r.status, 400, "upload didn't arrive yet");
    objects.set(job.original_key, 5000);
    r = await call('POST', `/api/video/jobs/${jobId}/uploaded`, null, as(WS_A));
    assert.strictEqual(r.body.job.status, 'queued');
    assert.strictEqual((await call('GET', `/api/video/jobs/${jobId}`, null, as(WS_B))).status, 404, "business B can't see A's video");
    assert.strictEqual((await call('DELETE', `/api/video/jobs/${jobId}`, null, as(WS_B))).status, 404, "or delete it");
    console.log('✓ upload goes straight to storage in the business\'s own folder; queued once it really arrived; other businesses get 404');
  }

  // 3. The worker: token required; claims; progress; plan; upload; complete.
  {
    assert.strictEqual((await worker('/heartbeat', {}, 'wrong-token')).status, 401);
    assert.strictEqual((await worker('/heartbeat')).status, 200);
    assert.strictEqual((await call('GET', '/api/video/status', null, as(WS_A))).body.worker.online, true, 'checked in: online');

    const claim = await worker('/claim');
    assert.strictEqual(claim.body.job.id, jobId);
    assert(claim.body.job.originalUrl.startsWith('https://r2.test/get/'), 'a signed link, never storage keys');
    assert.deepStrictEqual(claim.body.job.brand.colors, ['#E4572E', '#1B1B1E']);
    assert.strictEqual((await worker('/claim')).body.job, null, 'a job is claimed once');
    assert.strictEqual((await call('POST', `/api/video-worker/jobs/${jobId}/progress`, { workerId: 'other', stage: 'cut' }, { Authorization: `Bearer ${process.env.VIDEO_WORKER_TOKEN}` })).status, 404, 'another worker can\'t touch it');

    let r = await worker(`/jobs/${jobId}/progress`, { stage: 'transcribe', progress: 12 });
    assert.strictEqual(r.body.ok, true);
    let mine = (await call('GET', `/api/video/jobs/${jobId}`, null, as(WS_A))).body;
    assert.strictEqual(mine.stage, 'transcribe');
    assert.strictEqual(mine.stage_log.at(-1).label, 'Transcribing');

    const W = (s, t0) => { let t = t0; return s.split(' ').map((x) => { const w = { text: x, start: t, end: t + 0.35 }; t += 0.4; return w; }); };
    const words = [...W('Welcome to our kitchen. Today I want', 0.3), ...W("Let's redo that.", 4), ...W('Welcome to our kitchen. Today I want to show you jollof.', 6)];
    r = await worker(`/jobs/${jobId}/plan`, { words, duration: 12 });
    assert.strictEqual(r.body.parts.length, 1);
    assert(r.body.retakesRemoved >= 1 && r.body.parts[0].ranges[0].start >= 5.9, 'the failed take and "let\'s redo that" are cut');

    r = await worker(`/jobs/${jobId}/upload`, { name: 'Amas_Jollof_Ad_tiktok_9x16.mp4', contentType: 'video/mp4' });
    assert(r.body.key.startsWith(`ws/${WS_A}/jobs/${jobId}/output/`));
    objects.set(r.body.key, 90000);
    const outKey = r.body.key;
    r = await worker(`/jobs/${jobId}/complete`, {
      outputs: [{ key: outKey, name: 'Amas_Jollof_Ad_tiktok_9x16.mp4', role: 'video', format: '9x16', width: 1080, height: 1920 }, { key: `ws/${WS_B}/jobs/x/output/steal.mp4`, name: 'x' }],
      notes: ['I removed 1 retake.'], parts: [{ title: null, transcript: 'Welcome to our kitchen. Today I want to show you jollof.' }],
    });
    assert.strictEqual(r.body.ok, true);
    mine = (await call('GET', `/api/video/jobs/${jobId}`, null, as(WS_A))).body;
    assert.strictEqual(mine.status, 'done');
    assert.strictEqual(mine.result.outputs.length, 1, "files outside the job's own folder are ignored");
    assert(mine.result.outputs[0].downloadUrl.includes('name=Amas_Jollof_Ad_tiktok_9x16.mp4'), 'download keeps the new name');
    assert(!mine.result.outputs[0].key, 'no storage keys to the browser');
    assert.strictEqual(mine.output_bytes, 90000, 'size as stored');
    // The post caption + hashtags arrive just after.
    for (let i = 0; i < 50 && !(await jobs.get(jobId, WS_A)).result.post; i++) await new Promise((x) => setTimeout(x, 20));
    const post = (await jobs.get(jobId, WS_A)).result.post;
    assert(post && post.parts.length === 1 && post.parts[0].platform === 'TikTok', 'a TikTok caption + hashtags for the video');
    console.log('✓ worker: token checked; claims once; only its own job; progress shows live; retakes planned; uploads only into the job\'s folder; done with download links + post caption/hashtags');
  }

  // 4. Housekeeping: a quiet worker's job goes back in the queue; old files are deleted.
  {
    const j = await jobs.create({ workspaceId: WS_A, userId: 'u', kind: 'test_clip', answers: {} });
    const claimed = await jobs.claimNext('laptop');
    assert.strictEqual(claimed.id, j.id);
    jobs._mem.jobs.find((x) => x.id === j.id).heartbeat_at = new Date(Date.now() - 11 * 60000).toISOString();
    assert.strictEqual(await jobs.requeueStale(), 1);
    assert.strictEqual((await jobs.get(j.id, WS_A)).status, 'queued', 'laptop went to sleep: the job starts again later');
    const done = jobs._mem.jobs.find((x) => x.id === jobId);
    done.expires_at = new Date(Date.now() - 1000).toISOString();
    assert.strictEqual(await jobs.cleanup() >= 1, true);
    assert.strictEqual((await jobs.get(jobId, WS_A)).status, 'expired');
    assert(![...objects.keys()].some((k) => k.includes(jobId)), `files deleted after ${jobs.KEEP_DAYS} days`);
    console.log(`✓ a job whose worker went quiet is retried; finished videos are deleted after ${jobs.KEEP_DAYS} days (free storage)`);
  }

  // 5. Storage limits.
  {
    const big = await call('POST', '/api/video/jobs', { name: 'huge.mp4', bytes: 5 * 1024 ** 3, contentType: 'video/mp4', platform: 'youtube', cta: 'Subscribe', style: 'clean' }, as(WS_A));
    assert(/up to 4 GB/.test(big.body.fieldErrors.file));
    assert(/storage/.test(await jobs.storageProblem(WS_A, 2 * 1024 ** 3)), 'a business can\'t fill the free storage');
    console.log('✓ storage limits keep everyone inside the free 10 GB');
  }

  // 6. Planner: an AI answer that doesn't check out is ignored; "let's redo that" is always cut.
  {
    const W = (s, t0) => { let t = t0; return s.split(' ').map((x) => { const w = { text: x, start: t, end: t + 0.3 }; t += 0.35; return w; }); };
    const words = [...W('Hi everyone.', 0), ...W('Scratch that.', 2), ...W('Hi everyone, welcome back.', 4), ...W('Big news today.', 8)];
    const bad = await cutPlanner.plan({ words, duration: 10 }, { ask: async () => '{"drop":[0,1,2,3],"parts":[]}' });
    assert(bad.parts[0].ranges.length >= 1 && bad.decidedBy === 'rules', 'dropping everything is refused');
    const good = await cutPlanner.plan({ words, duration: 10 }, { ask: async () => '{"drop":[0],"parts":[{"from":2,"to":3,"title":"Big news"}]}' });
    assert.strictEqual(good.decidedBy, 'ai');
    assert(!/Scratch/.test(good.transcriptText) && !/^Hi everyone\. /.test(good.transcriptText));
    assert.strictEqual(good.parts[0].title, 'Big news');
    // Two videos in one recording -> two parts (rules).
    const two = await cutPlanner.plan({ words: [...W('Hello and welcome to part one.', 0), ...W('That is all for now.', 3), ...W('Hello again, this is video two.', 12)], duration: 16 });
    assert.strictEqual(two.parts.length, 2, 'a fresh greeting after a long break starts a new video');
    // Pauses longer than 0.5 s are cut.
    const p = cutPlanner.rangesFor(cutPlanner.sentencesOf([{ text: 'one', start: 0, end: 0.3 }, { text: 'two', start: 1.5, end: 1.8 }]), new Set([0, 1]), 0, 1, 3);
    assert.strictEqual(p.ranges.length, 2);
    assert.strictEqual(p.pausesCut, 1);
    console.log('✓ planner: best take kept; "let\'s redo that" always cut; bad AI answers ignored; separate videos split; pauses over 0.5 s cut');
  }

  // 7. Step 0: project files belong to their business; signed links instead of localhost.
  {
    const { claimProject, canAccess } = require('../core/projectOwnership');
    const { WORKSPACE_ROOT, resolveSafePath } = require('../plugins/filesystem/workspaceSafety');
    claimProject('owner-test-proj', WS_A);
    assert.strictEqual(await canAccess('owner-test-proj', WS_A), true);
    assert.strictEqual(await canAccess('owner-test-proj', WS_B), false, "a client can't open another business's project");
    const ws = require('../core/workspaceContext');
    const real = ws.getAppOwnerWorkspaceId;
    ws.getAppOwnerWorkspaceId = async () => WS_A;
    fs.mkdirSync(resolveSafePath('legacy-proj', '.'), { recursive: true });
    assert.strictEqual(await canAccess('legacy-proj', WS_A), true, 'old unstamped projects: the app owner');
    assert.strictEqual(await canAccess('legacy-proj', WS_B), false, '...and nobody else');
    ws.getAppOwnerWorkspaceId = real;
    const files = await require('../plugins/filesystem/actions/listFiles').run({ projectId: 'owner-test-proj' });
    assert(!JSON.stringify(files).includes('codecraft-owner'), 'the stamp is not listed');

    const fileLinks = require('../core/fileLinks');
    fs.writeFileSync(resolveSafePath('owner-test-proj', 'cover.png'), 'png');
    const url = fileLinks.signedFileUrl('owner-test-proj', 'cover.png');
    assert(url.startsWith('https://codecraft-backend.example.com/files/owner-test-proj/cover.png?exp='), url);
    const a = express();
    a.get('/files/:projectId/*', fileLinks.serveSignedFile);
    const s2 = await new Promise((r) => { const s = a.listen(0, '127.0.0.1', () => r(s)); });
    const local = url.replace('https://codecraft-backend.example.com', `http://127.0.0.1:${s2.address().port}`);
    assert.strictEqual((await fetch(local)).status, 200);
    assert.strictEqual((await fetch(local.replace('cover.png', 'other.png'))).status, 403, 'a link opens only its own file');
    assert.strictEqual((await fetch(local.replace(/sig=[^&]+/, 'sig=forged'))).status, 403);
    s2.close();
    for (const p of ['owner-test-proj', 'legacy-proj']) fs.rmSync(`${WORKSPACE_ROOT}/${p}`, { recursive: true, force: true });
    console.log('✓ project files belong to their business (others get 404); cover-image links are signed public links, not localhost');
  }

  server.close();
  console.log('\nAll video editor (backend) tests passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
