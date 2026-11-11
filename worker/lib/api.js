const fs = require('fs');
const http = require('http');
const https = require('https');
const { config } = require('./config');

/**
 * Talking to the CodeCraft backend (/api/video-worker, worker token) and
 * moving files with the signed links it hands out. The token is sent only to
 * BACKEND_URL; signed storage links carry no token at all.
 */

async function call(path, body = {}) {
  const res = await fetch(`${config.backendUrl}/api/video-worker${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ workerId: config.workerId, ...body }),
    signal: AbortSignal.timeout(120000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(json?.error || `backend answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json || {};
}

/** Stream a signed link to a file (videos can be gigabytes - never held in memory). */
function download(url, dest, { onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => {
      const lib = u.startsWith('https:') ? https : http;
      lib.get(u, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
          res.resume();
          return get(new URL(res.headers.location, u).toString(), redirects + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`download failed (HTTP ${res.statusCode})`)); }
        const total = Number(res.headers['content-length']) || 0;
        let got = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (c) => { got += c.length; if (onProgress && total) onProgress(got / total); });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve({ bytes: got })));
        out.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

/** PUT a file to a signed link, with its exact size (storage rejects chunked uploads). */
function upload(url, file, contentType, { onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    const size = fs.statSync(file).size;
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'PUT', headers: { 'Content-Type': contentType, 'Content-Length': size } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve({ bytes: size }) : reject(new Error(`upload failed (HTTP ${res.statusCode}): ${body.slice(0, 300)}`))));
    });
    req.on('error', reject);
    let sent = 0;
    const stream = fs.createReadStream(file);
    stream.on('data', (c) => { sent += c.length; if (onProgress) onProgress(sent / size); });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

module.exports = { call, download, upload };
