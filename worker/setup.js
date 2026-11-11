#!/usr/bin/env node
/**
 * One-time setup for the video worker: `npm run setup` in the worker folder.
 *
 *   - checks Node 22+ and the bundled FFmpeg
 *   - Windows: downloads whisper.cpp's official prebuilt whisper-cli.exe
 *     (free, from github.com/ggml-org/whisper.cpp releases) for HyperFrames'
 *     local transcription. Linux/Docker builds it from source instead.
 *   - makes sure HyperFrames' headless Chrome is installed (free, local)
 *   - creates worker/.env from .env.example if it doesn't exist yet
 *
 * Downloads only; nothing is sent anywhere. The Whisper model itself
 * (small.en, ~470 MB) downloads the first time a video is transcribed.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const WHISPER_RELEASE = 'b5454'; // pinned: the newest release with a Windows x64 build
const WHISPER_ZIP = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-x64.zip`;

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'codecraft-video-worker-setup' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function whisperWindows() {
  const dir = path.join(ROOT, '.tools', 'whisper');
  const exe = path.join(dir, 'Release', 'whisper-cli.exe');
  if (!fs.existsSync(exe)) {
    console.log(`  downloading whisper.cpp ${WHISPER_RELEASE} (about 9 MB)...`);
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, 'whisper-bin-x64.zip');
    await download(WHISPER_ZIP, zip);
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const r = spawnSync(tar, ['-xf', zip, '-C', dir], { stdio: 'inherit' });
    fs.rmSync(zip, { force: true });
    if (r.status !== 0 || !fs.existsSync(exe)) throw new Error('could not unpack whisper-bin-x64.zip');
  }
  const check = spawnSync(exe, ['--help'], { encoding: 'utf8' });
  if (check.error || (check.status !== 0 && !/usage/i.test(`${check.stdout}${check.stderr}`))) {
    throw new Error(`whisper-cli.exe doesn't start (${check.error?.message || `exit ${check.status}`}). Installing the Microsoft Visual C++ Redistributable (free, from microsoft.com) usually fixes this.`);
  }
  ok(`local Whisper ready (${path.relative(ROOT, exe)})`);
}

async function main() {
  console.log('CodeCraft video worker setup\n');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) { bad(`Node ${process.versions.node} - Node 22 or newer is needed (nodejs.org)`); process.exit(1); }
  ok(`Node ${process.versions.node}`);

  const ffmpeg = require('ffmpeg-static');
  const v = spawnSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (v.status !== 0) { bad('bundled FFmpeg does not run - try `npm install` again'); process.exit(1); }
  ok(`FFmpeg ${(v.stdout.match(/ffmpeg version (\S+)/) || [])[1]}`);

  if (process.platform === 'win32') {
    try { await whisperWindows(); } catch (err) { bad(`Whisper: ${err.message}`); process.exitCode = 1; }
  } else {
    ok('Whisper: HyperFrames builds it on first use (needs git, cmake and a C compiler - the Docker image has them)');
  }

  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', PATH: [path.dirname(ffmpeg), path.dirname(require('ffprobe-static').path), process.env.PATH].join(path.delimiter) };
  const hf = path.join(ROOT, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
  const b = spawnSync(process.execPath, [hf, 'browser', 'ensure'], { stdio: 'inherit', env });
  if (b.status === 0) ok('HyperFrames headless browser ready'); else { bad('HyperFrames browser setup failed'); process.exitCode = 1; }
  spawnSync(process.execPath, [hf, 'telemetry', 'disable'], { stdio: 'ignore', env });
  ok('HyperFrames telemetry off');

  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) {
    fs.copyFileSync(path.join(ROOT, '.env.example'), envFile);
    ok('created worker/.env - open it and fill in BACKEND_URL and VIDEO_WORKER_TOKEN');
  } else {
    ok('worker/.env exists');
  }
  console.log(process.exitCode ? '\nSetup finished with problems (see ✗ above).' : '\nAll set. Start the worker with:  npm start   (or double-click start-worker.bat)');
}

main().catch((err) => { bad(err.message); process.exit(1); });
