// End to end, on this machine: the real backend routes (/api/video,
// /api/video-worker) with in-memory tables, a stand-in for R2 (a little HTTP
// server), and the real worker loop - upload, the 3 answers, claim, cut,
// captions with HyperFrames, 7-second test clip, top-quality export, upload,
// done with download links. Only Whisper is replaced (words are given), so
// this runs before `npm run setup`. Takes a few minutes on a laptop.

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const assert = require('assert');

const BACKEND = path.join(__dirname, '..', '..', 'backend');
process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.VIDEO_WORKER_TOKEN = 'e2e-worker-token-0123456789abcdef';
process.env.HYPERFRAMES_NO_TELEMETRY = '1';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-'));
  const bucket = path.join(dir, 'bucket');
  fs.mkdirSync(bucket);
  const fileOf = (key) => path.join(bucket, encodeURIComponent(key));

  // Stand-in R2: PUT stores, GET serves.
  const r2 = http.createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
    if (req.method === 'PUT') { const out = fs.createWriteStream(fileOf(key)); req.pipe(out); out.on('finish', () => { res.writeHead(200); res.end(); }); return; }
    if (req.method === 'GET' && fs.existsSync(fileOf(key))) { res.writeHead(200, { 'Content-Length': fs.statSync(fileOf(key)).size }); fs.createReadStream(fileOf(key)).pipe(res); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => r2.listen(0, '127.0.0.1', r));
  const r2url = `http://127.0.0.1:${r2.address().port}`;
  const storage = require(path.join(BACKEND, 'core/video/storage'));
  storage._useDriver({
    uploadUrl: async (key) => `${r2url}/${encodeURIComponent(key)}`,
    downloadUrl: async (key) => `${r2url}/${encodeURIComponent(key)}`,
    sizeOf: async (key) => (fs.existsSync(fileOf(key)) ? fs.statSync(fileOf(key)).size : null),
    deletePrefix: async () => 0,
    deleteKey: async () => {},
  });

  // The backend's video routes.
  const express = require(path.join(BACKEND, 'node_modules/express'));
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api/video-worker', require(path.join(BACKEND, 'api/videoWorkerRoutes')));
  app.use('/api/video', (req, _res, next) => { req.user = { id: 'u1', workspaceId: 'aaaaaaaa-0000-0000-0000-0000000000e2', workspaceRole: 'owner' }; next(); }, require(path.join(BACKEND, 'api/videoRoutes')));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const backend = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, p, body) => (await fetch(backend + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();

  // The worker, pointed at this backend.
  process.env.BACKEND_URL = backend;
  process.env.WORK_DIR = path.join(dir, 'work');
  const media = require('../lib/media');
  media.transcribe = async () => [
    ...'Welcome to Amas Kitchen. Today I want'.split(' ').map((t, i) => ({ text: t, start: 0.3 + i * 0.4, end: 0.6 + i * 0.4 })),
    { text: "Let's", start: 4, end: 4.3 }, { text: 'redo', start: 4.35, end: 4.6 }, { text: 'that.', start: 4.65, end: 4.9 },
    ...'Welcome to Amas Kitchen. Try our jollof today!'.split(' ').map((t, i) => ({ text: t, start: 6 + i * 0.4, end: 6.3 + i * 0.4 })),
  ];
  const { ffmpeg } = require('../lib/run');
  const { work } = require('../index');

  // A 10 s 1280x720 "recording".
  const src = path.join(dir, 'Amas Jollof.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000', '-t', '10', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', src]);

  await api('PUT', '/api/video/brand-kit', { colors: ['#E4572E', '#FFE066'], font: 'Poppins' });
  const status0 = await api('GET', '/api/video/status');
  assert.strictEqual(status0.worker.online, false, 'offline until the worker checks in');
  const created = await api('POST', '/api/video/jobs', { name: 'Amas Jollof.mp4', bytes: fs.statSync(src).size, contentType: 'video/mp4', platform: 'instagram', cta: 'Order on WhatsApp', style: 'captions' });
  await fetch(created.uploadUrl, { method: 'PUT', body: fs.readFileSync(src) });
  const queued = await api('POST', `/api/video/jobs/${created.job.id}/uploaded`);
  assert.strictEqual(queued.job.status, 'queued');
  console.log('✓ uploaded straight to storage and queued');

  const started = Date.now();
  await work();
  console.log(`  (worker finished in ${Math.round((Date.now() - started) / 1000)} s)`);
  const job = await api('GET', `/api/video/jobs/${created.job.id}`);
  assert.strictEqual(job.status, 'done', `job finished: ${job.error || job.status}`);
  assert.strictEqual((await api('GET', '/api/video/status')).worker.online, true, 'online after checking in');
  const names = job.result.outputs.map((o) => o.name);
  assert(names.includes('Amas_Jollof_test_7s.mp4') && names.includes('Amas_Jollof_instagram_9x16.mp4'), names.join(', '));
  const video = job.result.outputs.find((o) => o.role === 'video');
  assert.deepStrictEqual([video.width, video.height], [1080, 1920]);
  assert(video.duration < 8, `retake + pauses removed: ${video.duration}s of 10s`);
  assert(job.stage_log.some((s) => s.stage === 'graphics') && job.stage_log.some((s) => s.stage === 'test_clip'));
  assert(job.result.notes.some((n) => /retake/.test(n)) && job.result.notes.some((n) => /CRF 16/.test(n)));
  const out = path.join(dir, 'out.mp4');
  fs.writeFileSync(out, Buffer.from(await (await fetch(video.downloadUrl)).arrayBuffer()));
  const probed = await media.probe(out);
  assert.deepStrictEqual([probed.width, probed.height, probed.codec], [1080, 1920, 'h264']);
  const test = await media.probe(path.join(bucket, encodeURIComponent(job.result.outputs.find((o) => o.role === 'test_clip').downloadUrl.split('/').pop())).replace(/%25/g, '%'));
  assert(test.duration <= 7.1, `test clip is 7 s (${test.duration})`);
  console.log(`✓ worker: cut the retake, rendered branded captions, made the 7 s test clip, exported ${video.width}x${video.height} H.264, uploaded as new files: ${names.join(', ')}`);
  console.log(`  notes: ${job.result.notes.join(' | ')}`);

  server.close();
  r2.close();
  if (process.env.KEEP_TEMP !== 'true') fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nEnd-to-end video editor test passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
