/**
 * Video files in Cloudflare R2 (S3-compatible, free up to 10 GB).
 *
 * The browser uploads straight to R2 and downloads straight from R2 with
 * short-lived signed links, so big videos never pass through the Render
 * backend. The worker gets signed links too - it never holds R2 keys.
 *
 * Env (backend only): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET. Nothing is ever logged about them.
 *
 * Key layout (one folder per business):
 *   ws/<workspace>/jobs/<job>/original/<file>   the untouched upload
 *   ws/<workspace>/jobs/<job>/output/<file>     finished videos
 *   ws/<workspace>/brand/<file>                 logo and B-roll
 */

const UPLOAD_LINK_SECONDS = 6 * 60 * 60; // a big upload on a slow line
const DOWNLOAD_LINK_SECONDS = 60 * 60;

let client;
let drv = null; // test hook: an in-memory stand-in for R2

// Pasted values often carry spaces, line breaks or quotes - which break every signature.
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();

function settings() {
  return {
    accountId: clean(process.env.R2_ACCOUNT_ID),
    accessKeyId: clean(process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: clean(process.env.R2_SECRET_ACCESS_KEY),
    bucket: clean(process.env.R2_BUCKET),
  };
}

/**
 * A real round trip, the same way the browser and worker do it: upload a tiny
 * file with a signed link, check it's there, read it back, delete it. Returns
 * plain-language findings - never any key values.
 */
async function selfCheck() {
  const s = settings();
  const findings = [];
  const missing = ['accountId', 'accessKeyId', 'secretAccessKey', 'bucket'].filter((k) => !s[k]);
  if (missing.length) {
    return { ok: false, problem: `Missing on the backend: ${missing.map((k) => ({ accountId: 'R2_ACCOUNT_ID', accessKeyId: 'R2_ACCESS_KEY_ID', secretAccessKey: 'R2_SECRET_ACCESS_KEY', bucket: 'R2_BUCKET' }[k])).join(', ')}.` };
  }
  // R2's own shapes: account id 32 hex, access key id 32 hex, secret 64 hex.
  if (!/^[0-9a-f]{32}$/i.test(s.accountId)) findings.push(`R2_ACCOUNT_ID doesn't look right (it should be 32 letters/numbers from the R2 overview page; this one has ${s.accountId.length} characters).`);
  if (!/^[0-9a-f]{32}$/i.test(s.accessKeyId)) findings.push(`R2_ACCESS_KEY_ID doesn't look right (it should be 32 characters; this one has ${s.accessKeyId.length}).`);
  if (!/^[0-9a-f]{64}$/i.test(s.secretAccessKey)) {
    findings.push(`R2_SECRET_ACCESS_KEY doesn't look right: an R2 secret is 64 letters/numbers, this one has ${s.secretAccessKey.length}`
      + `${/^[A-Za-z0-9_-]{40}$/.test(s.secretAccessKey) ? ' - it looks like the "Token value" instead of the "Secret Access Key"' : ''}.`);
  }
  const key = `ws/_check/jobs/_check/output/storage-check-${Date.now()}.txt`;
  const body = 'CodeCraft storage check';
  try {
    const put = await fetch(await uploadUrl(key, 'text/plain', { seconds: 300 }), { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body });
    if (!put.ok) {
      const text = await put.text();
      const code = (/<Code>([^<]+)<\/Code>/.exec(text) || [])[1] || `HTTP ${put.status}`;
      const hint = {
        SignatureDoesNotMatch: 'R2_SECRET_ACCESS_KEY is wrong. Copy the "Secret Access Key" (not the "Token value") from the R2 API token page - or create a new token and copy both keys again.',
        InvalidAccessKeyId: 'R2_ACCESS_KEY_ID is wrong, or the token was deleted. Create a new R2 API token and copy its Access Key ID and Secret Access Key.',
        NoSuchBucket: `There's no bucket called "${s.bucket}" in this account - check R2_BUCKET (and R2_ACCOUNT_ID).`,
        AccessDenied: `The token can't write to "${s.bucket}" - give it "Object Read & Write" on this bucket.`,
      }[code] || `R2 refused the upload (${code}).`;
      return { ok: false, problem: hint, code, findings };
    }
    const size = await sizeOf(key);
    if (size !== body.length) return { ok: false, problem: 'The test file was uploaded but R2 reports a different size.', findings };
    const get = await fetch(await downloadUrl(key, { seconds: 300 }));
    if (!get.ok || (await get.text()) !== body) return { ok: false, problem: `Uploading works but reading it back failed (HTTP ${get.status}).`, findings };
    await deleteKey(key).catch(() => {});
    return { ok: true, findings, message: `Storage works: uploaded, checked, read back and deleted a test file in "${s.bucket}".` };
  } catch (err) {
    const net = /ENOTFOUND|getaddrinfo|fetch failed/i.test(`${err.message} ${err.cause?.code || ''}`);
    return { ok: false, problem: net ? "Couldn't reach R2 - check R2_ACCOUNT_ID (it's part of the storage address)." : `Storage check failed: ${err.message}`, findings };
  }
}

function isConfigured() {
  if (drv) return true;
  const s = settings();
  return !!(s.accountId && s.accessKeyId && s.secretAccessKey && s.bucket);
}

function s3() {
  if (client) return client;
  const { S3Client } = require('@aws-sdk/client-s3');
  const s = settings();
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${s.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    // R2's advice for current AWS SDKs: no automatic checksums, or signed links
    // expect a checksum header the browser and worker don't send.
    forcePathStyle: true, // <account>.r2.cloudflarestorage.com/<bucket>/<key>
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

function requireConfigured() {
  if (!isConfigured()) {
    const err = new Error('Video storage is not set up yet - add the R2_* settings on the backend (see docs/video-editor.md).');
    err.code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }
}

/** A safe file name for keys and downloads: letters, numbers, - _ . only. */
function safeName(name, fallback = 'video.mp4') {
  const base = String(name || '').split(/[\\/]/).pop().normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '');
  return (base || fallback).slice(0, 120);
}

/** Signed link the browser / worker PUTs the file to. */
async function uploadUrl(key, contentType, { seconds = UPLOAD_LINK_SECONDS } = {}) {
  requireConfigured();
  if (drv) return drv.uploadUrl(key, contentType);
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: settings().bucket, Key: key, ContentType: contentType }), { expiresIn: seconds });
}

/** Signed link to read a file; `downloadName` makes the browser save it under that name. */
async function downloadUrl(key, { downloadName = null, inline = false, seconds = DOWNLOAD_LINK_SECONDS } = {}) {
  requireConfigured();
  if (drv) return drv.downloadUrl(key, { downloadName, inline });
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const disposition = downloadName ? `${inline ? 'inline' : 'attachment'}; filename="${safeName(downloadName)}"` : undefined;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: settings().bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn: seconds });
}

/** Size of a stored file, or null when it isn't there. */
async function sizeOf(key) {
  requireConfigured();
  if (drv) return drv.sizeOf(key);
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: settings().bucket, Key: key }));
    return Number(head.ContentLength || 0);
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
    throw err;
  }
}

/** Delete every file under a prefix (a job's folder). Returns how many. */
async function deletePrefix(prefix) {
  requireConfigured();
  if (!prefix || !prefix.startsWith('ws/') || prefix.split('/').length < 4) throw new Error(`refusing to delete "${prefix}"`);
  if (drv) return drv.deletePrefix(prefix);
  const { ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
  let deleted = 0;
  let token;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: settings().bucket, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents || []).map((o) => ({ Key: o.Key }));
    if (keys.length) {
      await s3().send(new DeleteObjectsCommand({ Bucket: settings().bucket, Delete: { Objects: keys, Quiet: true } }));
      deleted += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

async function deleteKey(key) {
  requireConfigured();
  if (drv) return drv.deleteKey(key);
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await s3().send(new DeleteObjectCommand({ Bucket: settings().bucket, Key: key }));
}

const keys = {
  original: (ws, job, name) => `ws/${ws}/jobs/${job}/original/${safeName(name)}`,
  output: (ws, job, name) => `ws/${ws}/jobs/${job}/output/${safeName(name)}`,
  // Between planning and rendering: transcript, website screenshots (deleted with the job).
  work: (ws, job, name) => `ws/${ws}/jobs/${job}/work/${safeName(name, 'file')}`,
  jobPrefix: (ws, job) => `ws/${ws}/jobs/${job}/`,
  brand: (ws, name) => `ws/${ws}/brand/${Date.now().toString(36)}-${safeName(name, 'asset')}`,
  belongsTo: (ws, key) => typeof key === 'string' && key.startsWith(`ws/${ws}/`),
};

/** Tests: replace R2 with an in-memory stand-in (null restores R2). */
function _useDriver(d) { drv = d; }

module.exports = { selfCheck, isConfigured, uploadUrl, downloadUrl, sizeOf, deletePrefix, deleteKey, keys, safeName, _useDriver };
