/**
 * Website login details for ONE "make a video of my website" job - held only
 * here, in memory, and only in encrypted form.
 *
 * The browser encrypts the username/password with the video worker's public
 * key (AES-GCM, with the AES key wrapped by RSA-OAEP). This server can't read
 * them: it only keeps the sealed box until the worker picks up the job, hands
 * it over once, and forgets it. Never written to the database, logs, storage
 * or files. A server restart loses it (the job then asks for the login again).
 */

const TTL_MS = 12 * 60 * 60 * 1000;
const vault = new Map(); // jobId -> { sealed, at }

function isSealed(s) {
  return !!s && typeof s === 'object'
    && /^[\w-]{6,64}$/.test(s.keyId || '')
    && ['wrappedKey', 'iv', 'data'].every((k) => typeof s[k] === 'string' && /^[A-Za-z0-9+/=]+$/.test(s[k]) && s[k].length < 8000);
}

function put(jobId, sealed) {
  if (!isSealed(sealed)) return false;
  vault.set(jobId, { sealed: { keyId: sealed.keyId, wrappedKey: sealed.wrappedKey, iv: sealed.iv, data: sealed.data }, at: Date.now() });
  return true;
}

/** Hand over once (and forget). */
function take(jobId) {
  const e = vault.get(jobId);
  vault.delete(jobId);
  if (!e || Date.now() - e.at > TTL_MS) return null;
  return e.sealed;
}

function has(jobId) {
  const e = vault.get(jobId);
  return !!e && Date.now() - e.at <= TTL_MS;
}

function drop(jobId) { vault.delete(jobId); }

// Expired boxes are dropped every hour.
setInterval(() => { for (const [id, e] of vault) if (Date.now() - e.at > TTL_MS) vault.delete(id); }, 3600000).unref();

module.exports = { put, take, has, drop, isSealed, _size: () => vault.size };
