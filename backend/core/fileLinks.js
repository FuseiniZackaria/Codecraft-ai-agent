const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');
const { resolveSafePath, PROJECT_ID_PATTERN } = require('../plugins/filesystem/workspaceSafety');

/**
 * Shareable links to one generated file (e.g. Content Studio's cover image).
 *
 * A plain link in chat can't carry your login, so /api/workspace/... (which
 * needs it) can't be opened from a chat message. Instead these links are
 * signed: /files/<project>/<file>?exp=<time>&sig=<signature>. Only this
 * server can make a valid signature, a link opens exactly one file, and it
 * stops working when it expires. The address is the backend's public one
 * (Render), never "localhost".
 */

const DEFAULT_TTL_DAYS = 30;
const PROJECT_ZIP = '__project.zip'; // signedFileUrl(projectId, PROJECT_ZIP) = the whole project as a zip

let secret;
function key() {
  if (secret) return secret;
  const raw = process.env.FILE_LINK_SECRET || process.env.WORKSPACE_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!raw) {
    // No key configured: a random one, so links still work - until the server restarts.
    console.warn('[files] no WORKSPACE_ENCRYPTION_KEY - file links will stop working after a restart');
    secret = crypto.randomBytes(32);
    return secret;
  }
  secret = crypto.createHash('sha256').update(`codecraft-file-links:${raw}`).digest();
  return secret;
}

function sign(projectId, relativePath, exp) {
  return crypto.createHmac('sha256', key()).update(`${projectId}/${relativePath}:${exp}`).digest('base64url');
}

/** This backend's public address (Render's own, or BASE_URL), never localhost when deployed. */
function publicBaseUrl() {
  const base = process.env.PUBLIC_BACKEND_URL || process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || config.waha?.publicBackendUrl;
  return String(base || `http://localhost:${config.port}`).replace(/\/$/, '');
}

function signedFileUrl(projectId, relativePath, { ttlDays = DEFAULT_TTL_DAYS } = {}) {
  const rel = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  return `${publicBaseUrl()}/files/${projectId}/${encoded}?exp=${exp}&sig=${sign(projectId, rel, exp)}`;
}

/** Express handler for GET /files/:projectId/* (no login: the signature is the permission). */
function serveSignedFile(req, res) {
  const { projectId } = req.params;
  const rel = String(req.params[0] || '');
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig || '');
  if (!PROJECT_ID_PATTERN.test(projectId || '') || !rel || !Number.isFinite(exp) || !sig) return res.status(400).json({ error: 'Bad link' });
  if (exp < Date.now() / 1000) return res.status(410).json({ error: 'This link has expired' });
  let expected;
  try { expected = sign(projectId, rel, exp); } catch { return res.status(500).json({ error: 'Links are not set up on this server' }); }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Invalid link' });
  // The whole project as a zip (e.g. the Coding agent's download link).
  if (rel === PROJECT_ZIP) {
    return require('../tools/ToolRegistry').call('filesystem.zipProject', { projectId }, { role: 'api' })
      .then(({ zipPath }) => res.download(zipPath, `${projectId}.zip`))
      .catch(() => res.status(404).json({ error: 'This project is no longer on the server (generated files are cleared when the server restarts)' }));
  }
  try {
    const target = resolveSafePath(projectId, rel);
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'This file is no longer on the server (generated files are cleared when the server restarts)' });
    res.sendFile(target);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
}

module.exports = { signedFileUrl, serveSignedFile, publicBaseUrl, PROJECT_ZIP, _sign: sign };
