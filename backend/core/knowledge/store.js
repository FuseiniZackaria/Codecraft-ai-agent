const crypto = require('crypto');
const config = require('../../config');

/**
 * Storage for the knowledge-base tables (migration 0006_knowledge_base.sql).
 * Every function takes a workspaceId and only ever touches that workspace's
 * rows - one business can never read or change another's.
 *
 * Supabase when configured, otherwise in memory (tests, local runs without a
 * database).
 */

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}

const mem = { versions: [], qa: [], docs: [], chunks: [], files: new Map() };

function check(error, where) {
  if (!error) return;
  // A missing table means migration 0006 hasn't been run yet - say so plainly.
  if (/does not exist|schema cache/i.test(error.message)) {
    const err = new Error('The knowledge-base tables are missing - run backend/database/migrations/0006_knowledge_base.sql in Supabase (SQL Editor).');
    err.code = 'MIGRATION_MISSING';
    throw err;
  }
  throw new Error(`knowledge store (${where}): ${error.message}`);
}

function requireWs(workspaceId) {
  if (!workspaceId) throw new Error('knowledge store: a workspaceId is required');
}

// ---------- agent instruction versions ----------

const VERSION_SUMMARY_COLUMNS = 'id, version, agent_name, note, created_by_email, created_at';

/** The newest saved version (the one in use), or null if none saved yet. */
async function getLatestVersion(workspaceId) {
  requireWs(workspaceId);
  if (!db()) {
    return mem.versions.filter((v) => v.workspace_id === workspaceId).sort((a, b) => b.version - a.version)[0] || null;
  }
  const { data, error } = await db().from('agent_instruction_versions').select('*')
    .eq('workspace_id', workspaceId).order('version', { ascending: false }).limit(1).maybeSingle();
  check(error, 'getLatestVersion');
  return data;
}

/** Newest first, without the full texts. */
async function listVersions(workspaceId, limit = 50) {
  requireWs(workspaceId);
  if (!db()) {
    return mem.versions.filter((v) => v.workspace_id === workspaceId).sort((a, b) => b.version - a.version).slice(0, limit)
      .map(({ id, version, agent_name, note, created_by_email, created_at }) => ({ id, version, agent_name, note, created_by_email, created_at }));
  }
  const { data, error } = await db().from('agent_instruction_versions').select(VERSION_SUMMARY_COLUMNS)
    .eq('workspace_id', workspaceId).order('version', { ascending: false }).limit(limit);
  check(error, 'listVersions');
  return data || [];
}

async function getVersion(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) return mem.versions.find((v) => v.workspace_id === workspaceId && v.id === id) || null;
  const { data, error } = await db().from('agent_instruction_versions').select('*')
    .eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  check(error, 'getVersion');
  return data;
}

/** Save as the next version number. Retries once if two saves race for the same number. */
async function addVersion(workspaceId, fields) {
  requireWs(workspaceId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const latest = await getLatestVersion(workspaceId);
    const row = {
      workspace_id: workspaceId,
      version: (latest?.version || 0) + 1,
      agent_name: fields.agent_name,
      instructions: fields.instructions,
      examples: fields.examples || [],
      hold_reply: fields.hold_reply || null,
      note: fields.note || null,
      created_by: fields.created_by || null,
      created_by_email: fields.created_by_email || null,
    };
    if (!db()) {
      const saved = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
      mem.versions.push(saved);
      return saved;
    }
    const { data, error } = await db().from('agent_instruction_versions').insert(row).select().single();
    if (error && /duplicate key/i.test(error.message) && attempt === 0) continue;
    check(error, 'addVersion');
    return data;
  }
  throw new Error('knowledge store: could not save the new version - please try again');
}

// ---------- Q&A entries ----------

const QA_COLUMNS = 'id, workspace_id, question, answer, enabled, source, source_message_id, created_at, updated_at';
const QA_MAX_LIST = 1000;

/** All entries, newest first (enabledOnly: just the ones switched on). */
async function listQa(workspaceId, { enabledOnly = false, limit = QA_MAX_LIST } = {}) {
  requireWs(workspaceId);
  if (!db()) {
    // Newest first; same-millisecond entries keep the order they were added in.
    return mem.qa.map((q, i) => ({ q, i }))
      .filter(({ q }) => q.workspace_id === workspaceId && (!enabledOnly || q.enabled))
      .sort((a, b) => String(b.q.created_at).localeCompare(String(a.q.created_at)) || b.i - a.i)
      .slice(0, limit).map(({ q }) => ({ ...q }));
  }
  let query = db().from('kb_qa_entries').select(QA_COLUMNS).eq('workspace_id', workspaceId);
  if (enabledOnly) query = query.eq('enabled', true);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  check(error, 'listQa');
  return data || [];
}

async function countQa(workspaceId) {
  requireWs(workspaceId);
  if (!db()) return mem.qa.filter((q) => q.workspace_id === workspaceId).length;
  const { count, error } = await db().from('kb_qa_entries').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
  check(error, 'countQa');
  return count || 0;
}

async function getQa(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) { const q = mem.qa.find((x) => x.workspace_id === workspaceId && x.id === id); return q ? { ...q } : null; }
  const { data, error } = await db().from('kb_qa_entries').select(QA_COLUMNS).eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  check(error, 'getQa');
  return data;
}

async function createQa(workspaceId, fields) {
  requireWs(workspaceId);
  const row = {
    workspace_id: workspaceId,
    question: fields.question,
    answer: fields.answer,
    enabled: fields.enabled !== false,
    source: fields.source || 'manual',
    source_message_id: fields.source_message_id || null,
    created_by: fields.created_by || null,
  };
  if (!db()) {
    const at = new Date().toISOString();
    const saved = { id: crypto.randomUUID(), created_at: at, updated_at: at, ...row };
    mem.qa.push(saved);
    return { ...saved };
  }
  const { data, error } = await db().from('kb_qa_entries').insert(row).select(QA_COLUMNS).single();
  check(error, 'createQa');
  return data;
}

/** Only question / answer / enabled can change. Returns null if not found in this workspace. */
async function updateQa(workspaceId, id, patch) {
  requireWs(workspaceId);
  const fields = {};
  for (const k of ['question', 'answer', 'enabled']) if (patch[k] !== undefined) fields[k] = patch[k];
  fields.updated_at = new Date().toISOString();
  if (!db()) {
    const q = mem.qa.find((x) => x.workspace_id === workspaceId && x.id === id);
    if (!q) return null;
    Object.assign(q, fields);
    return { ...q };
  }
  const { data, error } = await db().from('kb_qa_entries').update(fields).eq('workspace_id', workspaceId).eq('id', id).select(QA_COLUMNS).maybeSingle();
  check(error, 'updateQa');
  return data;
}

/** Returns true if something was deleted. */
async function deleteQa(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) {
    const before = mem.qa.length;
    mem.qa = mem.qa.filter((x) => !(x.workspace_id === workspaceId && x.id === id));
    return mem.qa.length < before;
  }
  const { data, error } = await db().from('kb_qa_entries').delete().eq('workspace_id', workspaceId).eq('id', id).select('id');
  check(error, 'deleteQa');
  return (data || []).length > 0;
}

/**
 * Switched-on entries sharing any of these words (Postgres full-text search;
 * ranking is done by the caller). terms: plain lower-case words.
 */
async function searchQa(workspaceId, terms, limit = 60) {
  requireWs(workspaceId);
  if (!terms.length) return [];
  if (!db()) {
    return mem.qa.filter((q) => q.workspace_id === workspaceId && q.enabled
      && terms.some((t) => `${q.question} ${q.answer}`.toLowerCase().includes(t))).slice(0, limit).map((q) => ({ ...q }));
  }
  const { data, error } = await db().from('kb_qa_entries').select(QA_COLUMNS)
    .eq('workspace_id', workspaceId).eq('enabled', true)
    .textSearch('search', terms.join(' or '), { type: 'websearch', config: 'english' })
    .limit(limit);
  check(error, 'searchQa');
  return data || [];
}

// ---------- documents ----------

const DOC_COLUMNS = 'id, workspace_id, filename, mime_type, size_bytes, storage_path, status, error, chunk_count, char_count, uploaded_by, created_at, updated_at, processed_at';
const BUCKET = 'knowledge-docs';

async function listDocuments(workspaceId) {
  requireWs(workspaceId);
  if (!db()) {
    return mem.docs.filter((d) => d.workspace_id === workspaceId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((d) => ({ ...d }));
  }
  const { data, error } = await db().from('kb_documents').select(DOC_COLUMNS).eq('workspace_id', workspaceId).order('created_at', { ascending: false });
  check(error, 'listDocuments');
  return data || [];
}

async function getDocument(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) { const d = mem.docs.find((x) => x.workspace_id === workspaceId && x.id === id); return d ? { ...d } : null; }
  const { data, error } = await db().from('kb_documents').select(DOC_COLUMNS).eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  check(error, 'getDocument');
  return data;
}

async function createDocument(workspaceId, fields) {
  requireWs(workspaceId);
  const row = { id: fields.id || crypto.randomUUID(), workspace_id: workspaceId, status: 'processing', ...fields };
  if (!db()) {
    const at = new Date().toISOString();
    const saved = { error: null, chunk_count: 0, char_count: 0, processed_at: null, created_at: at, updated_at: at, ...row };
    mem.docs.push(saved);
    return { ...saved };
  }
  const { data, error } = await db().from('kb_documents').insert(row).select(DOC_COLUMNS).single();
  check(error, 'createDocument');
  return data;
}

async function updateDocument(workspaceId, id, fields) {
  requireWs(workspaceId);
  const patch = { ...fields, updated_at: new Date().toISOString() };
  if (!db()) {
    const d = mem.docs.find((x) => x.workspace_id === workspaceId && x.id === id);
    if (!d) return null;
    Object.assign(d, patch);
    return { ...d };
  }
  const { data, error } = await db().from('kb_documents').update(patch).eq('workspace_id', workspaceId).eq('id', id).select(DOC_COLUMNS).maybeSingle();
  check(error, 'updateDocument');
  return data;
}

/** Deletes the row (its sections go with it). Returns true if something was deleted. */
async function deleteDocument(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) {
    const before = mem.docs.length;
    mem.docs = mem.docs.filter((x) => !(x.workspace_id === workspaceId && x.id === id));
    mem.chunks = mem.chunks.filter((c) => c.document_id !== id);
    return mem.docs.length < before;
  }
  const { data, error } = await db().from('kb_documents').delete().eq('workspace_id', workspaceId).eq('id', id).select('id');
  check(error, 'deleteDocument');
  return (data || []).length > 0;
}

/** Swap a document's searchable sections for new ones (old ones stay usable until this runs). */
async function replaceChunks(workspaceId, documentId, contents) {
  requireWs(workspaceId);
  const rows = contents.map((content, i) => ({ document_id: documentId, workspace_id: workspaceId, chunk_index: i, content }));
  if (!db()) {
    mem.chunks = mem.chunks.filter((c) => c.document_id !== documentId).concat(rows.map((r) => ({ id: crypto.randomUUID(), ...r })));
    return;
  }
  const del = await db().from('kb_document_chunks').delete().eq('workspace_id', workspaceId).eq('document_id', documentId);
  check(del.error, 'replaceChunks (delete)');
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db().from('kb_document_chunks').insert(rows.slice(i, i + 200));
    check(error, 'replaceChunks (insert)');
  }
}

/** A document's sections in order (for "View text" and small knowledge bases). */
async function listChunks(workspaceId, { documentId = null, limit = 500 } = {}) {
  requireWs(workspaceId);
  if (!db()) {
    return mem.chunks.filter((c) => c.workspace_id === workspaceId && (!documentId || c.document_id === documentId))
      .sort((a, b) => (a.document_id === b.document_id ? a.chunk_index - b.chunk_index : a.document_id.localeCompare(b.document_id)))
      .slice(0, limit).map((c) => ({ ...c }));
  }
  let q = db().from('kb_document_chunks').select('id, document_id, chunk_index, content').eq('workspace_id', workspaceId);
  if (documentId) q = q.eq('document_id', documentId);
  const { data, error } = await q.order('document_id').order('chunk_index').limit(limit);
  check(error, 'listChunks');
  return data || [];
}

/** Sections sharing any of these words (Postgres full-text search; ranked by the caller). */
async function searchChunks(workspaceId, terms, limit = 60) {
  requireWs(workspaceId);
  if (!terms.length) return [];
  if (!db()) {
    return mem.chunks.filter((c) => c.workspace_id === workspaceId && terms.some((t) => c.content.toLowerCase().includes(t)))
      .slice(0, limit).map((c) => ({ ...c }));
  }
  const { data, error } = await db().from('kb_document_chunks').select('id, document_id, chunk_index, content')
    .eq('workspace_id', workspaceId)
    .textSearch('search', terms.join(' or '), { type: 'websearch', config: 'english' })
    .limit(limit);
  check(error, 'searchChunks');
  return data || [];
}

// Original files, in the private "knowledge-docs" storage bucket (memory in tests).
async function putFile(path, buffer, contentType) {
  if (!db()) { mem.files.set(path, Buffer.from(buffer)); return; }
  const { error } = await db().storage.from(BUCKET).upload(path, buffer, { contentType: contentType || 'application/octet-stream', upsert: true });
  if (error) throw new Error(`couldn't store the file (${error.message})`);
}

async function getFile(path) {
  if (!db()) {
    if (!mem.files.has(path)) throw new Error('the stored file is missing');
    return mem.files.get(path);
  }
  const { data, error } = await db().storage.from(BUCKET).download(path);
  if (error) throw new Error(`couldn't read the stored file (${error.message})`);
  return Buffer.from(await data.arrayBuffer());
}

async function removeFiles(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  if (!db()) { for (const p of list) mem.files.delete(p); return; }
  const { error } = await db().storage.from(BUCKET).remove(list);
  if (error) console.warn(`[knowledge] couldn't delete stored file(s): ${error.message}`);
}

/** Test hook. */
function _resetMemory() {
  mem.versions = [];
  mem.qa = [];
  mem.docs = [];
  mem.chunks = [];
  mem.files = new Map();
}

module.exports = {
  getLatestVersion, listVersions, getVersion, addVersion,
  listQa, countQa, getQa, createQa, updateQa, deleteQa, searchQa, QA_MAX_LIST,
  listDocuments, getDocument, createDocument, updateDocument, deleteDocument,
  replaceChunks, listChunks, searchChunks, putFile, getFile, removeFiles,
  _resetMemory,
};
