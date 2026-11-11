const fs = require('fs');
const http = require('http');
const https = require('https');
const { config } = require('./config');

/**
 * Talking to the CodeCraft backend (/api/video-worker, worker token) and
 * moving files with the signed links it hands out. The token is sent only to
 * BACKEND_URL; signed storage links carry no token at all.
 */

// Short network drops and Render restarting (502/503/504) are retried: 5 s, 15 s, 30 s, 60 s.
const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transient = (err) => !err.status || [502, 503, 504].includes(err.status);

/** Why a request failed, in a few words (e.g. "connection reset", "no internet / DNS"). */
function reason(err) {
  const code = err?.cause?.code || err?.code || '';
  return {
    ENOTFOUND: 'no internet / address not found', EAI_AGAIN: 'no internet / DNS', ECONNRESET: 'connection reset',
    ECONNREFUSED: 'connection refused', ETIMEDOUT: 'timed out', UND_ERR_CONNECT_TIMEOUT: 'connect timed out',
    UND_ERR_SOCKET: 'connection dropped', TimeoutError: 'no answer in 2 min',
  }[code] || (err?.name === 'TimeoutError' ? 'no answer in 2 min' : code || err?.message || 'unknown');
}

async function once(path, body) {
  let res;
  try {
    res = await fetch(`${config.backendUrl}/api/video-worker${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ workerId: config.workerId, ...body }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    const e = new Error(`can't reach the backend (${reason(err)})`);
    e.network = true;
    throw e;
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(json?.error || `backend answered ${res.status}${[502, 503, 504].includes(res.status) ? ' (it may be restarting)' : ''}`);
    err.status = res.status;
    throw err;
  }
  return json || {};
}

/** Call the backend; network blips and restarts are retried (`retries` times) before giving up. */
async function call(path, body = {}, { retries = RETRY_DELAYS_MS.length } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(path, body);
    } catch (err) {
      if (attempt >= retries || !transient(err)) throw err;
      const wait = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      console.log(`${new Date().toISOString().slice(11, 19)}   (${err.message} - trying again in ${wait / 1000} s)`);
      await sleep(wait);
    }
  }
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

/** PUT a file to a signed link (retried up to 3 times if the connection drops). */
async function upload(url, file, contentType, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await uploadOnce(url, file, contentType, opts);
    } catch (err) {
      if (attempt >= 2 || /HTTP 4\d\d/.test(err.message)) throw err; // 4xx = wrong link/keys: retrying won't help
      console.log(`${new Date().toISOString().slice(11, 19)}   (upload interrupted: ${reason(err)} - trying again in 10 s)`);
      await sleep(10000);
    }
  }
}

/** PUT a file to a signed link, with its exact size (storage rejects chunked uploads). */
function uploadOnce(url, file, contentType, { onProgress = null } = {}) {
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
