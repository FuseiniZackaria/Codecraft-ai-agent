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

const mem = { versions: [] };

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

/** Test hook. */
function _resetMemory() {
  mem.versions = [];
}

module.exports = { getLatestVersion, listVersions, getVersion, addVersion, _resetMemory };
