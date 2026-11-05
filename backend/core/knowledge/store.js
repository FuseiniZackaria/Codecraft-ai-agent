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

const mem = { versions: [], qa: [] };

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

/** Test hook. */
function _resetMemory() {
  mem.versions = [];
  mem.qa = [];
}

module.exports = {
  getLatestVersion, listVersions, getVersion, addVersion,
  listQa, countQa, getQa, createQa, updateQa, deleteQa, searchQa, QA_MAX_LIST,
  _resetMemory,
};
