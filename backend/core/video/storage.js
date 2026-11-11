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

function settings() {
  return {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || '',
  };
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
  jobPrefix: (ws, job) => `ws/${ws}/jobs/${job}/`,
  brand: (ws, name) => `ws/${ws}/brand/${Date.now().toString(36)}-${safeName(name, 'asset')}`,
  belongsTo: (ws, key) => typeof key === 'string' && key.startsWith(`ws/${ws}/`),
};

/** Tests: replace R2 with an in-memory stand-in (null restores R2). */
function _useDriver(d) { drv = d; }

module.exports = { isConfigured, uploadUrl, downloadUrl, sizeOf, deletePrefix, deleteKey, keys, safeName, _useDriver };
