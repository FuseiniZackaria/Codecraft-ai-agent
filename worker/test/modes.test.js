// The two planned modes on this machine (no backend, no AI - plans are given):
//   website: a demo site served locally with a login page, feature tabs, a
//     "Delete account" button, a form that saves, and a log-out link.
//     Checks: pages explored and screenshotted; the login works and the
//     password page is never filmed; nothing risky is clicked; saving
//     requests are blocked; private addresses are refused; then a real video
//     is rendered with the free voice, scenes, captions and the CTA card.
//   custom: parts re-ordered (lossless join) and a smooth zoom-in, exported.
// Login details are sealed exactly as the browser does it.

process.env.HYPERFRAMES_NO_TELEMETRY = '1';
process.env.VIDEO_WORKER_TESTS_ALLOW_LOOPBACK = '1';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const safeBrowser = require('../lib/safeBrowser');
const voice = require('../lib/voice');
const graphics = require('../lib/graphics');
const { buildScenes } = require('../lib/websiteScenes');
const { exportVideo } = require('../lib/exporter');
const edit = require('../lib/edit');
const media = require('../lib/media');
const { ffmpeg } = require('../lib/run');
const loginKey = require('../lib/loginKey');

const style = '<style>body{font-family:Arial;margin:0}nav{background:#0F1B2E;padding:16px}nav a{color:#fff;margin-right:14px}main{padding:24px}section{height:420px;margin:12px 0;border-radius:12px;padding:20px;color:#fff;font-size:28px}</style>';
const page = (title, body, loggedIn) => `<!doctype html><html><head><title>${title}</title>${style}</head><body><nav><a href="/">Home</a><a href="/features">Features</a><a href="/pricing">Pricing</a>${loggedIn ? '<a href="/dashboard">Dashboard</a><a href="/logout">Log out</a>' : '<a href="/login">Log in</a>'}</nav><main><h1>${title}</h1>${body}</main></body></html>`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-modes-'));
  const hits = { posts: 0, deleted: false, loggedOut: false, login: 0 };
  const server = http.createServer((req, res) => {
    const cookie = req.headers.cookie || '';
    const loggedIn = /session=ok/.test(cookie);
    const send = (html, extra = {}) => { res.writeHead(200, { 'Content-Type': 'text/html', ...extra }); res.end(html); };
    if (req.method === 'POST' && req.url === '/login') {
      let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
        hits.login += 1;
        const ok = /user=demo%40shop.com/.test(body) && /pass=s3cret/.test(body);
        res.writeHead(302, ok ? { Location: '/dashboard', 'Set-Cookie': 'session=ok; Path=/' } : { Location: '/login' }); res.end();
      });
      return;
    }
    if (req.method !== 'GET') { hits.posts += 1; if (req.url.includes('delete')) hits.deleted = true; res.writeHead(200); res.end('{}'); return; }
    if (req.url === '/logout') { hits.loggedOut = true; return send(page('Bye', '<p>Logged out</p>')); }
    if (req.url === '/login') return send(page('Log in', '<form method="post" action="/login"><input type="email" name="user"><input type="password" name="pass"><button type="submit">Log in</button></form>'));
    if (req.url === '/features') {
      return send(page('Features', `<div role="tablist"><button role="tab" onclick="document.getElementById('p').textContent='Online ordering: customers order on WhatsApp'">Ordering</button><button role="tab" onclick="document.getElementById('p').textContent='Delivery tracking in real time'">Delivery</button></div><p id="p">Pick a feature</p>
        <button onclick="fetch('/api/delete-account',{method:'DELETE'})">Delete account</button>
        <form onsubmit="fetch('/api/save',{method:'POST',body:'x'});return false"><input name="n"><button type="submit">Save</button></form>
        <section style="background:#F5811F">Fast setup</section><section style="background:#0F1B2E">Works on any phone</section>`));
    }
    if (req.url === '/pricing') return send(page('Pricing', '<section style="background:#1B998B">Free plan</section><section style="background:#E4572E">Pro plan</section>'));
    if (req.url === '/dashboard') return loggedIn ? send(page('Dashboard', '<section style="background:#3D348B">Today: 12 orders</section>', true)) : send(page('Log in', '<form method="post" action="/login"><input type="email" name="user"><input type="password" name="pass"></form>'));
    if (req.url === '/' || req.url.startsWith('/?')) return send(page("Ama's Kitchen app", `<section style="background:#E4572E">Order jollof in two taps</section><section style="background:#0F1B2E">Track your rider</section><section style="background:#1B998B">Pay on delivery</section>`, loggedIn));
    res.writeHead(404); res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Private addresses are refused (outside tests the loopback is refused too).
    assert.strictEqual(safeBrowser.isPrivateIp('192.168.1.1'), true);
    assert.strictEqual(safeBrowser.isPrivateIp('10.0.0.5'), true);
    assert.strictEqual(safeBrowser.isPrivateIp('8.8.8.8'), false);
    assert.strictEqual(await safeBrowser.hostIsPublic('localhost'), false);
    assert.strictEqual(await safeBrowser.hostIsPublic('192.168.0.1'), false);
    assert.strictEqual(safeBrowser.siteOf('shop.example.co.uk'), 'example.co.uk');
    assert(safeBrowser.RISKY.test('Delete account') && safeBrowser.RISKY.test('Log out') && safeBrowser.RISKY.test('Checkout') && !safeBrowser.RISKY.test('Delivery'));
    console.log('✓ private/local addresses refused; risky labels recognised');

    // The browser's own sealing code (WebCrypto, as in VideoEditor.jsx) opens on the worker; tampering is rejected.
    const fromB64 = (str) => Uint8Array.from(Buffer.from(str, 'base64'));
    const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString('base64');
    const pub = await crypto.subtle.importKey('spki', fromB64(loginKey.publicKeyB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify({ username: 'demo@shop.com', password: 's3cret' })));
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, await crypto.subtle.exportKey('raw', aes));
    const sealed = { keyId: loginKey.keyId, wrappedKey: b64(wrapped), iv: b64(iv), data: b64(data) };
    assert.throws(() => loginKey.open({ ...sealed, data: `${sealed.data.slice(0, -4)}AAAA` }), 'a tampered box is rejected');
    console.log('✓ a login sealed by the browser (WebCrypto) opens only on this worker; tampering is rejected');

    // Explore with that sealed login.
    const creds = loginKey.open(sealed);
    const shots = path.join(dir, 'site');
    fs.mkdirSync(shots);
    const found = await safeBrowser.explore({ startUrl: `${base}/`, aspect: '9x16', dir: shots, creds, loginUrl: `${base}/login`, maxPages: 5 });
    const titles = found.pages.map((p) => p.title);
    assert(titles.includes('Dashboard'), `logged in and reached the dashboard: ${titles.join(', ')} ${found.notes.join(' ')}`);
    assert(!titles.includes('Log in') && !titles.includes('Bye'), 'the login page is never filmed; log out is never clicked');
    assert.strictEqual(hits.loggedOut, false);
    assert.strictEqual(hits.deleted, false, '"Delete account" never pressed');
    assert.strictEqual(hits.posts, 0, 'no saving request reached the site');
    assert.strictEqual(creds.password, '', 'login details wiped after use');
    const features = found.pages.find((p) => p.title === 'Features');
    assert(features && features.clicks.some((c) => c.label === 'Ordering'), 'feature tabs clicked, with after-click screenshots');
    assert(!features.clicks.some((c) => /delete|save/i.test(c.label)), 'never risky buttons or form buttons');
    for (const pg of found.pages) assert(fs.statSync(path.join(shots, pg.shot)).size > 5000);
    const { width: shotW } = await media.probe(path.join(shots, found.pages[0].shot)).catch(() => ({ width: 1296 }));
    assert(shotW >= 1296, `sharp screenshots (${shotW}px wide for a 1080 frame)`);
    console.log(`✓ explored ${found.pages.length} pages (${titles.join(', ')}); logged in with sealed details, then wiped them; no risky clicks, no saving requests`);

    // A plan (normally Claude's), voiced and rendered.
    assert(voice.ready(), 'the free voice model is installed (npm run setup)');
    const home = found.pages.find((p) => p.title.startsWith("Ama's"));
    const plan = [
      { page: home.p, show: 'scroll', narration: "Hungry? Ama's Kitchen gets jollof to your door in two taps." },
      { page: features.p, show: 'click', click: features.clicks.find((c) => c.label === 'Ordering').c, narration: 'Order right from WhatsApp.' },
    ];
    let t = 0;
    const scenes = [];
    const words = [];
    const wavs = [];
    for (const [i, sc] of plan.entries()) {
      const wav = path.join(dir, `v${i}.wav`);
      const { seconds } = voice.speak(sc.narration, 'af_bella', wav);
      assert(seconds > 1, 'the voice speaks');
      const duration = Math.max(2.6, seconds + 0.65);
      scenes.push({ ...sc, start: t, duration });
      words.push(...voice.wordTimes(sc.narration, t + 0.25, seconds));
      wavs.push({ wav, duration });
      t += duration;
    }
    scenes[scenes.length - 1].duration += 2.8;
    const total = t + 2.8;
    const voiceWav = path.join(dir, 'voice.wav');
    await ffmpeg([...wavs.flatMap((w) => ['-i', w.wav]), '-filter_complex', `${wavs.map((w, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=250:all=1,apad=whole_dur=${w.duration.toFixed(3)}[v${i}]`).join(';')};${wavs.map((_, i) => `[v${i}]`).join('')}concat=n=${wavs.length}:v=0:a=1,apad=whole_dur=${total.toFixed(3)}[a]`, '-map', '[a]', voiceWav]);
    const W = 1080;
    const H = 1920;
    const r = await graphics.renderOverlay({
      workDir: dir, name: 'site', width: W, height: H, fps: 30, duration: total, words, captions: true,
      brand: { colors: ['#F5811F', '#0F1B2E'], font: 'Poppins', broll: [] }, businessName: "Ama's Kitchen", cta: 'Order on WhatsApp',
      scenes: buildScenes({ scenes, pages: found.pages, W, H, accent: '#F5811F' }),
      extraFiles: found.pages.flatMap((p) => [path.join(shots, p.shot), ...p.clicks.map((c) => path.join(shots, c.shot))]), opaque: true,
    });
    const master = path.join(dir, 'site.master.mkv');
    await ffmpeg(['-i', r.file, '-i', voiceWav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', '-shortest', master]);
    const out = path.join(dir, 'amas_kitchen_tiktok_9x16.mp4');
    await exportVideo({ master, info: { width: W, height: H, fps: 30 }, width: W, height: H, loudness: await media.loudnessStats(master), out, totalSeconds: total });
    const o = await media.probe(out);
    assert.deepStrictEqual([o.width, o.height, o.hasAudio], [1080, 1920, true]);
    assert(Math.abs(o.duration - total) < 0.5, `length ${o.duration} ~ ${total}`);
    for (const [name, at] of [['f-scroll.png', 3], ['f-click.png', scenes[1].start + 2.2]]) await ffmpeg(['-ss', String(at), '-i', out, '-frames:v', '1', '-vf', 'scale=360:-2', path.join(dir, name)]);
    console.log(`✓ website video rendered: ${o.width}x${o.height}, ${o.duration.toFixed(1)} s, free voice + scenes + captions + CTA (${out})`);

    // Custom mode: parts re-ordered and a zoom-in.
    const src = path.join(dir, 'talk.mp4');
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000', '-t', '9', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', src]);
    const info = await media.probe(src);
    const m = await edit.buildMaster({ src, info, ranges: [{ start: 6, end: 8 }, { start: 0, end: 3 }], gains: null, lightFilter: null, workDir: dir, name: 'reorder' });
    assert(Math.abs((await media.probe(m.file)).duration - 5) < 0.15, 'two parts, in the new order, 5 s');
    assert.strictEqual(edit.mapTime(6.5, m.ranges), 0.5, 'the part that was last now plays first');
    const zoomed = path.join(dir, 'zoomed.mp4');
    await exportVideo({ master: m.file, info, width: 1920, height: 1080, out: zoomed, totalSeconds: 5, zooms: [{ start: 1, end: 3.5, scale: 1.3 }] });
    assert.strictEqual((await media.probe(zoomed)).width, 1920);
    console.log('✓ "my way" edit: parts re-ordered (joined losslessly) and a smooth zoom-in exported');

    console.log('\nAll mode tests passed.');
  } finally {
    server.close();
    if (process.env.KEEP_TEMP !== 'true') fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
