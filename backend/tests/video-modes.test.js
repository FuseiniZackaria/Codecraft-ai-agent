// Video editor modes (backend): "edit my video my way" and "make a video of
// my website". Plans are written with Sonnet and checked strictly (bad page,
// click or word numbers, unknown photos dropped; "can't do" kept); the plan
// waits for Approve / Change it; website logins live only in memory, sealed,
// are handed to the worker exactly once and never reach the database; private
// links are refused; working files are deleted after the render.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.VIDEO_WORKER_TOKEN = 'test-worker-token-0123456789abcdef';

const assert = require('assert');
const express = require('express');
const storage = require('../core/video/storage');
const jobs = require('../core/video/jobs');
const brandKit = require('../core/video/brandKit');
const editPlanner = require('../core/video/editPlanner');
const loginVault = require('../core/video/loginVault');
const mockProvider = require('../core/providers/mockProvider');

const objects = new Map();
const deleted = [];
storage._useDriver({
  uploadUrl: async (key) => `https://r2.test/put/${encodeURIComponent(key)}`,
  downloadUrl: async (key) => `https://r2.test/get/${encodeURIComponent(key)}`,
  sizeOf: async (key) => objects.get(key) ?? null,
  deletePrefix: async (prefix) => { deleted.push(prefix); return 0; },
  deleteKey: async () => {},
});

let aiAnswer = '{}';
let lastAiCall = null;
mockProvider.complete = async (opts) => { lastAiCall = opts; return { text: typeof aiAnswer === 'function' ? aiAnswer(opts) : aiAnswer, provider: 'mock', costEstimate: 0 }; };

const WS = 'aaaaaaaa-0000-0000-0000-0000000000m1';
const W = (s, t0) => { let t = t0; return s.split(' ').map((x) => { const w = { text: x, start: t, end: t + 0.3 }; t += 0.35; return w; }); };

(async () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/video-worker', require('../api/videoWorkerRoutes'));
  app.use('/api/video', (req, _res, next) => { req.user = { id: 'u1', email: 'owner@example.com', workspaceId: WS, workspaceRole: 'owner' }; next(); }, require('../api/videoRoutes'));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const worker = (p, body = {}) => call('POST', `/api/video-worker${p}`, { workerId: 'laptop', ...body }, { Authorization: `Bearer ${process.env.VIDEO_WORKER_TOKEN}` });
  await brandKit.save(WS, { colors: ['#F5811F', '#0F1B2E'], font: 'Poppins' });

  // 1. The worker's public key reaches the page (so the browser can seal a login for it).
  {
    await worker('/heartbeat', { keyId: 'wabc123def', publicKey: 'TUlJQklq' });
    const st = await call('GET', '/api/video/status');
    assert.deepStrictEqual(st.body.worker.loginKey, { keyId: 'wabc123def', publicKey: 'TUlJQklq' });
    assert(st.body.voices.some((v) => v.id === 'am_michael'), 'free voices listed');
    console.log("✓ the worker's public key and the free voices reach the page");
  }

  // 2. Website job: link, permission, private addresses; the sealed login stays in memory only.
  let siteJob;
  {
    let r = await call('POST', '/api/video/jobs', { mode: 'website', url: 'http://192.168.1.1/admin', description: 'x', platform: 'tiktok', cta: 'Visit us', style: 'captions' });
    assert(r.body.fieldErrors.url && r.body.fieldErrors.permission, 'private links refused; permission required');
    r = await call('POST', '/api/video/jobs', { mode: 'website', url: 'localhost:3000', description: 'x', permission: true, platform: 'tiktok', cta: 'Visit', style: 'clean' });
    assert(r.body.fieldErrors.url);
    const sealed = { keyId: 'wabc123def', wrappedKey: 'QUFBQQ==', iv: 'QkJCQg==', data: 'Q0NDQw==' };
    r = await call('POST', '/api/video/jobs', {
      mode: 'website', url: 'amaskitchen.com', description: 'A 45-second TikTok showing how to order', voice: 'af_bella', permission: true,
      platform: 'tiktok', cta: 'Order on WhatsApp', style: 'captions', login: sealed,
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    siteJob = r.body.job;
    assert.strictEqual(siteJob.status, 'queued', 'no upload needed: straight into the queue');
    const row = jobs._mem.jobs.find((j) => j.id === siteJob.id);
    assert.strictEqual(row.request.url, 'https://amaskitchen.com/');
    assert.strictEqual(row.request.voice, 'af_bella');
    assert.strictEqual(row.request.needsLogin, true);
    assert(!JSON.stringify(row).includes('QUFBQQ') && !JSON.stringify(row).includes('wrappedKey'), 'the login is NOT in the database row');
    assert.strictEqual(loginVault.has(siteJob.id), true, 'sealed, in memory');
    console.log('✓ website job: private links refused, permission required; the login is sealed in memory, never in the database');
  }

  // 3. Claim: the login is handed over once; the plan; submit -> waits for approval; worker released.
  {
    const c = await worker('/claim');
    assert.strictEqual(c.body.job.id, siteJob.id);
    assert.strictEqual(c.body.job.mode, 'website');
    assert.strictEqual(c.body.job.phase, 'plan');
    assert.strictEqual(c.body.job.login.wrappedKey, 'QUFBQQ==', 'the sealed box goes to the worker...');
    assert.strictEqual(loginVault.has(siteJob.id), false, '...and is forgotten by the server');
    aiAnswer = JSON.stringify({
      title: 'Order jollof in 2 taps', summary: ['Show the home page, then ordering'], cant_do: ['Background music'],
      scenes: [{ page: 0, show: 'scroll', narration: 'Hungry? Here is Ama\'s Kitchen.' }, { page: 1, show: 'click', click: 0, narration: 'Order in two taps.' },
        { page: 1, show: 'click', click: 9, narration: 'Bad click number becomes the top of the page.' }, { page: 7, show: 'top', narration: 'A page that was never explored is dropped.' }],
    });
    const pages = [{ p: 0, url: 'https://amaskitchen.com/', title: 'Home', headings: ['Order jollof'], text: 'Fresh food', clicks: [] },
      { p: 1, url: 'https://amaskitchen.com/features', title: 'Features', headings: [], text: '', clicks: [{ c: 0, label: 'Ordering' }] }];
    const plan = await worker(`/jobs/${siteJob.id}/plan-website`, { pages, thumbs: [{ p: 0, base64: 'AAAA' }] });
    assert.strictEqual(lastAiCall.claudeModel, 'claude-sonnet-5-5', 'planned with Sonnet');
    assert(lastAiCall.content.some((x) => x.inlineData), 'the page screenshots are shown to the planner');
    assert.deepStrictEqual(plan.body.scenes.map((s) => [s.page, s.show, s.click]), [[0, 'scroll', null], [1, 'click', 0], [1, 'top', null]]);
    assert.deepStrictEqual(plan.body.cant_do, ['Background music']);
    assert.strictEqual(plan.body.targetSeconds, 45, '"45-second" is read from the description');
    const sub = await worker(`/jobs/${siteJob.id}/submit-plan`, { plan: { ...plan.body, thumbFiles: { 0: 'thumb0.jpg' } }, files: ['page0.png', 'thumb0.jpg', '../../escape.png'] });
    assert.strictEqual(sub.body.ok, true);
    const job = (await call('GET', `/api/video/jobs/${siteJob.id}`)).body;
    assert.strictEqual(job.status, 'awaiting_approval');
    assert(job.plan.thumbUrls['0'].includes('work%2Fthumb0.jpg'), 'scene screenshots shown for approval');
    assert(!job.plan.files.some((f) => f.includes('/')), 'saved file names stay inside the job folder');
    assert.strictEqual(jobs._mem.jobs.find((j) => j.id === siteJob.id).worker_id, null, 'the worker let go while you decide');
    console.log('✓ plan (Sonnet, with screenshots) is checked: bad clicks/pages fixed or dropped, "can\'t do" kept; it waits for your approval');
  }

  // 4. Change it / Approve -> render with the saved files; work files deleted after.
  {
    let r = await call('POST', `/api/video/jobs/${siteJob.id}/revise`, { description: 'Make it 30 seconds and start with the menu' });
    assert.strictEqual(r.body.job.status, 'queued');
    let row = jobs._mem.jobs.find((j) => j.id === siteJob.id);
    assert.strictEqual(row.phase, 'plan');
    assert.strictEqual(row.request.description, 'Make it 30 seconds and start with the menu');
    // plan again (the worker would re-explore; no login available any more -> it would ask again)
    const c = await worker('/claim');
    assert.strictEqual(c.body.job.login, null, 'the login was used once and is gone');
    await worker(`/jobs/${siteJob.id}/submit-plan`, { plan: { kind: 'website', title: 'T', scenes: [{ page: 0, show: 'top', narration: 'Hi' }], pages: [] }, files: ['page0.png'] });
    r = await call('POST', `/api/video/jobs/${siteJob.id}/approve`);
    assert.strictEqual(r.body.job.status, 'queued');
    row = jobs._mem.jobs.find((j) => j.id === siteJob.id);
    assert.strictEqual(row.phase, 'render');
    const c2 = await worker('/claim');
    assert.strictEqual(c2.body.job.phase, 'render');
    assert(c2.body.job.files['page0.png'].includes('work%2Fpage0.png'), 'the render gets the planning files');
    const up = await worker(`/jobs/${siteJob.id}/upload`, { name: 't_tiktok_9x16.mp4', contentType: 'video/mp4' });
    objects.set(up.body.key, 5000);
    await worker(`/jobs/${siteJob.id}/complete`, { outputs: [{ key: up.body.key, name: 't_tiktok_9x16.mp4', role: 'video' }], parts: [{ title: 'T', transcript: 'Hi' }] });
    await new Promise((x) => setTimeout(x, 50));
    assert(deleted.some((p) => p.endsWith(`${siteJob.id}/work/`)), 'screenshots (maybe of logged-in pages) deleted right after the render');
    console.log('✓ "Change it" plans again; "Approve" renders with the saved files; working files are deleted at the end');
  }

  // 5. Custom plan: strict checks, ordered ranges, retakes/pauses inside parts, fallback.
  {
    const words = [...W('Hi everyone welcome back.', 0), ...W('Delivery is free in Accra.', 3), ...W('Our jollof is the best.', 6), ...W('Order today on WhatsApp.', 9)];
    aiAnswer = JSON.stringify({
      summary: ['Start with the jollof line', 'Then delivery'], cant_do: ['Add music'],
      segments: [{ from: 10, to: 14 }, { from: 4, to: 9 }, { from: 99, to: 120 }], captions: true,
      zooms: [{ from: 10, to: 12, scale: 3 }], titles: [{ at: 10, text: 'Best jollof in town', seconds: 2 }],
      broll: [{ at: 4, image: 'rider.jpg', seconds: 3 }, { at: 4, image: 'not-in-kit.jpg' }],
    });
    const plan = await editPlanner.customPlan({ words, duration: 12, description: 'jollof first', images: ['rider.jpg'] });
    assert.strictEqual(lastAiCall.claudeModel, 'claude-sonnet-5-5');
    assert.deepStrictEqual(plan.segments, [{ from: 10, to: 14 }, { from: 4, to: 9 }], 'bad word numbers dropped');
    assert.strictEqual(plan.zooms[0].scale, 1.6, 'zoom capped');
    assert.deepStrictEqual(plan.broll.map((b) => b.image), ['rider.jpg'], 'only photos that exist');
    assert.deepStrictEqual(plan.cant_do, ['Add music']);
    assert(plan.render.ranges[0].start > plan.render.ranges[plan.render.ranges.length - 1].start, 'played in the new order');
    const fb = await worker('/claim'); // no job; just check the fallback directly
    void fb;
    aiAnswer = 'not json';
    const custom = await jobs.create({ workspaceId: WS, userId: 'u1', mode: 'custom', request: { description: 'cut the intro' }, originalName: 'a.mp4', bytes: 10, answers: { platform: 'instagram', cta: 'x', style: 'captions' } });
    jobs._mem.jobs.find((j) => j.id === custom.id).status = 'queued';
    await worker('/claim');
    const pf = await worker(`/jobs/${custom.id}/plan-custom`, { words, duration: 12 });
    assert.strictEqual(pf.body.fallback, true, "if the AI doesn't answer, the automatic edit is offered as the plan");
    assert(/automatic edit/.test(pf.body.summary[0]));
    const r = await call('POST', '/api/video/jobs', { mode: 'custom', name: 'b.mp4', bytes: 10, contentType: 'video/mp4', platform: 'tiktok', cta: 'x', style: 'clean' });
    assert(r.body.fieldErrors.description, '"my way" needs a description');
    console.log('✓ "my way" plan: re-ordering, zoom/titles/photos checked, "can\'t do" kept; automatic edit offered if the AI fails');
  }

  // 6. Deleting a waiting website job forgets its login.
  {
    const j = await jobs.create({ workspaceId: WS, userId: 'u1', mode: 'website', request: { url: 'https://x.com/', needsLogin: true } });
    loginVault.put(j.id, { keyId: 'wabc123def', wrappedKey: 'AA==', iv: 'AA==', data: 'AA==' });
    await call('DELETE', `/api/video/jobs/${j.id}`);
    assert.strictEqual(loginVault.has(j.id), false);
    console.log('✓ deleting a job forgets its login straight away');
  }

  server.close();
  console.log('\nAll video mode (backend) tests passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
