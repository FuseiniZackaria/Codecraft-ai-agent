const crypto = require('crypto');
const store = require('./store');

/**
 * Documents (Settings -> General -> Documents): menus, price lists, policies.
 *
 * Upload -> the original is kept in the private "knowledge-docs" storage
 * bucket -> the text is pulled out and split into small sections -> the
 * WhatsApp agent searches those sections for each customer message.
 *
 * Status shown on the page: processing -> ready (N sections) | failed (reason).
 * Processing runs in the background right after the upload or replace, so the
 * page never waits on a big PDF. Replacing a file re-processes it; the old
 * sections stay in use until the new ones are ready, then they're swapped.
 */

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CHARS = 500000; // text kept per document (~250 pages)
const CHUNK_CHARS = 1200;
const STALE_MS = 10 * 60 * 1000; // "processing" for longer than this = interrupted (e.g. a restart)

// extension -> { kind, label }
const TYPES = {
  pdf: { kind: 'pdf', label: 'PDF' },
  docx: { kind: 'docx', label: 'Word' },
  txt: { kind: 'text', label: 'Text' },
  md: { kind: 'text', label: 'Text' },
  csv: { kind: 'sheet', label: 'CSV' },
  xlsx: { kind: 'sheet', label: 'Excel' },
};
const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`);

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function extensionOf(filename) {
  const m = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/** Keep a readable name, safe for a storage path. */
function safeName(filename) {
  const base = String(filename || 'document').split(/[\\/]/).pop().replace(/[^\w.\- ()]+/g, '_').trim();
  return (base || 'document').slice(0, 120);
}

/** Checks an upload. Returns { buffer, ext, filename }. */
function checkUpload({ filename, data }) {
  const name = safeName(filename);
  const ext = extensionOf(name);
  if (!TYPES[ext]) {
    if (ext === 'doc') throw fail('INVALID', 'Old Word files (.doc) can\'t be read - open it in Word and "Save as" .docx, then upload that.');
    throw fail('INVALID', `This file type isn't supported. Upload a PDF, Word (.docx), text (.txt), CSV or Excel (.xlsx) file.`);
  }
  if (typeof data !== 'string' || !data) throw fail('INVALID', 'The file is empty.');
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length) throw fail('INVALID', 'The file is empty.');
  if (buffer.length > MAX_BYTES) throw fail('INVALID', `The file is too big (max ${MAX_BYTES / 1024 / 1024} MB).`);
  return { buffer, ext, filename: name };
}

// ---------- text extraction ----------

function cleanText(text) {
  return String(text || '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function pdfText(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((page, i) => `[Page ${i + 1}]\n${page}`).join('\n\n');
}

async function docxText(buffer) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

/** Spreadsheets become one line per row: "Item: Jollof | Price: GHS 45" - easy to search and read. */
function sheetText(buffer, ext) {
  const XLSX = require('xlsx');
  const wb = ext === 'csv' ? XLSX.read(buffer.toString('utf8').replace(/^﻿/, ''), { type: 'string' }) : XLSX.read(buffer, { type: 'buffer' });
  const parts = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false });
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim()));
    if (!nonEmpty.length) continue;
    const header = nonEmpty[0].map((h, i) => String(h).trim() || `Column ${i + 1}`);
    const lines = nonEmpty.slice(1).map((r) => header
      .map((h, i) => (String(r[i] ?? '').trim() ? `${h}: ${String(r[i]).trim()}` : null))
      .filter(Boolean).join(' | '));
    if (wb.SheetNames.length > 1) parts.push(`[Sheet: ${sheetName}]`);
    parts.push(...(lines.length ? lines : [header.join(' | ')]));
  }
  return parts.join('\n');
}

async function extract(buffer, ext) {
  const { kind } = TYPES[ext];
  if (kind === 'pdf') return pdfText(buffer);
  if (kind === 'docx') return docxText(buffer);
  if (kind === 'sheet') return sheetText(buffer, ext);
  return buffer.toString('utf8');
}

/**
 * Split into ~CHUNK_CHARS sections on paragraph/line boundaries, so each
 * section reads on its own. Very long lines are cut at a sentence or space.
 */
function chunk(text, size = CHUNK_CHARS) {
  const pieces = [];
  for (const para of text.split(/\n\n+/)) {
    if (para.length <= size) { pieces.push(para); continue; }
    for (const line of para.split('\n')) {
      let rest = line;
      while (rest.length > size) {
        let cut = rest.lastIndexOf('. ', size);
        if (cut < size / 2) cut = rest.lastIndexOf(' ', size);
        if (cut < size / 2) cut = size;
        pieces.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
      }
      if (rest.trim()) pieces.push(rest.trim());
    }
  }
  const chunks = [];
  let current = '';
  for (const p of pieces.filter(Boolean)) {
    if (current && current.length + p.length + 1 > size) { chunks.push(current); current = p; } else current = current ? `${current}\n${p}` : p;
  }
  if (current) chunks.push(current);
  return chunks;
}

const NO_TEXT = "No readable text was found. If it's a scanned PDF (a photo of paper), upload a Word or text version instead, or type the key facts into Q&A entries.";

/** Read the stored file and (re)build its sections. Never throws - the outcome is saved as the status. */
async function processDocument(workspaceId, documentId) {
  const doc = await store.getDocument(workspaceId, documentId).catch(() => null);
  if (!doc) return null;
  // If the file was replaced or deleted while this ran, the newer job owns the result.
  const superseded = async () => {
    const latest = await store.getDocument(workspaceId, documentId).catch(() => null);
    return !latest || latest.storage_path !== doc.storage_path;
  };
  try {
    const buffer = await store.getFile(doc.storage_path);
    let text = cleanText(await extract(buffer, extensionOf(doc.filename)));
    const truncated = text.length > MAX_CHARS;
    if (truncated) text = text.slice(0, MAX_CHARS);
    const sections = chunk(text);
    if (!text.replace(/\[(Page|Sheet)[^\]]*\]/g, '').trim() || !sections.length) throw fail('NO_TEXT', NO_TEXT);
    if (await superseded()) return null;
    await store.replaceChunks(workspaceId, documentId, sections);
    return await store.updateDocument(workspaceId, documentId, {
      status: 'ready',
      error: truncated ? `Only the first ${MAX_CHARS.toLocaleString()} characters are used - split the file to include the rest.` : null,
      chunk_count: sections.length, char_count: text.length, processed_at: new Date().toISOString(),
    });
  } catch (err) {
    const reason = err.code === 'NO_TEXT' ? err.message
      : /password|encrypt/i.test(err.message) ? 'The file is password-protected. Remove the password and upload it again.'
        : /zip|central directory|Invalid PDF|corrupt|Unsupported/i.test(err.message)
          ? "Couldn't read this file - it may be damaged or not really the type its name says. Open it, save it again and re-upload."
          : `Couldn't read this file (${err.message.replace(/https?:\/\/\S+/g, '').slice(0, 200).trim()}).`;
    if (await superseded()) return null;
    console.warn(`[knowledge] processing "${doc.filename}" failed: ${err.message}`);
    // A failed replace: the previous version's sections are removed so the agent never uses an outdated file.
    await store.replaceChunks(workspaceId, documentId, []).catch(() => {});
    return store.updateDocument(workspaceId, documentId, { status: 'failed', error: reason, chunk_count: 0, char_count: 0, processed_at: new Date().toISOString() })
      .catch(() => null);
  }
}

// Background processing (tests can await it).
const pending = new Set();
function processInBackground(workspaceId, documentId) {
  const p = processDocument(workspaceId, documentId).finally(() => pending.delete(p));
  pending.add(p);
  return p;
}
async function _waitForProcessing() {
  while (pending.size) await Promise.all([...pending]);
}

function storagePath(workspaceId, documentId, filename) {
  return `${workspaceId}/${documentId}/${Date.now()}-${filename}`;
}

async function upload(workspaceId, input, user = {}) {
  const { buffer, filename, ext } = checkUpload(input);
  const id = crypto.randomUUID();
  const path = storagePath(workspaceId, id, filename);
  await store.putFile(path, buffer, input.mime_type);
  const doc = await store.createDocument(workspaceId, {
    id, filename, mime_type: input.mime_type || null, size_bytes: buffer.length, storage_path: path, uploaded_by: user.id || null,
  }).catch(async (err) => { await store.removeFiles([path]); throw err; });
  processInBackground(workspaceId, doc.id);
  return { ...doc, type: TYPES[ext].label };
}

async function replace(workspaceId, documentId, input, user = {}) {
  const doc = await store.getDocument(workspaceId, documentId);
  if (!doc) throw fail('NOT_FOUND', 'That document was not found.');
  const { buffer, filename } = checkUpload(input);
  const path = storagePath(workspaceId, documentId, filename);
  await store.putFile(path, buffer, input.mime_type);
  const updated = await store.updateDocument(workspaceId, documentId, {
    filename, mime_type: input.mime_type || null, size_bytes: buffer.length, storage_path: path,
    status: 'processing', error: null, uploaded_by: user.id || doc.uploaded_by || null,
  });
  if (doc.storage_path && doc.storage_path !== path) await store.removeFiles([doc.storage_path]);
  processInBackground(workspaceId, documentId);
  return updated;
}

async function reprocess(workspaceId, documentId) {
  const doc = await store.getDocument(workspaceId, documentId);
  if (!doc) throw fail('NOT_FOUND', 'That document was not found.');
  const updated = await store.updateDocument(workspaceId, documentId, { status: 'processing', error: null });
  processInBackground(workspaceId, documentId);
  return updated;
}

async function remove(workspaceId, documentId) {
  const doc = await store.getDocument(workspaceId, documentId);
  if (!doc) throw fail('NOT_FOUND', 'That document was not found.');
  await store.deleteDocument(workspaceId, documentId);
  await store.removeFiles([doc.storage_path]);
}

/** List for the page. Anything "processing" for too long (e.g. the server restarted) is marked failed with a retry hint. */
async function list(workspaceId) {
  const docs = await store.listDocuments(workspaceId);
  const now = Date.now();
  return Promise.all(docs.map(async (d) => {
    if (d.status === 'processing' && now - new Date(d.updated_at).getTime() > STALE_MS && ![...pending].length) {
      return (await store.updateDocument(workspaceId, d.id, { status: 'failed', error: 'Processing was interrupted. Click "Process again".' }).catch(() => null)) || d;
    }
    return d;
  }));
}

module.exports = {
  upload, replace, reprocess, remove, list, processDocument,
  chunk, cleanText, extract, checkUpload,
  ACCEPT, MAX_BYTES, TYPES, _waitForProcessing,
};
