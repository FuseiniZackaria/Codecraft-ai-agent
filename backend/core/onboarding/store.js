const config = require('../../config');

/**
 * Storage for onboarding progress (migration 0009_onboarding.sql), one row per
 * workspace. Supabase when configured, otherwise in memory (tests).
 */

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}

const mem = new Map(); // workspaceId -> row
const EMPTY = { welcome_seen_at: null, skipped: [], checklist_hidden: false, tour_seen_by: [] };

function check(error, where) {
  if (!error) return;
  if (/does not exist|schema cache/i.test(error.message)) {
    const err = new Error('The onboarding table is missing - run backend/database/migrations/0009_onboarding.sql in Supabase (SQL Editor).');
    err.code = 'MIGRATION_MISSING';
    throw err;
  }
  throw new Error(`onboarding store (${where}): ${error.message}`);
}

async function get(workspaceId) {
  if (!workspaceId) throw new Error('onboarding store: a workspaceId is required');
  if (!db()) return { ...EMPTY, ...(mem.get(workspaceId) || {}), workspace_id: workspaceId };
  const { data, error } = await db().from('workspace_onboarding').select('*').eq('workspace_id', workspaceId).maybeSingle();
  check(error, 'get');
  return { ...EMPTY, ...(data || {}), workspace_id: workspaceId };
}

const FIELDS = ['welcome_seen_at', 'skipped', 'checklist_hidden', 'tour_seen_by'];

async function save(workspaceId, fields) {
  const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => FIELDS.includes(k)));
  if (!db()) {
    mem.set(workspaceId, { ...(mem.get(workspaceId) || {}), ...patch, updated_at: new Date().toISOString() });
    return get(workspaceId);
  }
  const current = await get(workspaceId);
  const row = { workspace_id: workspaceId, ...Object.fromEntries(FIELDS.map((k) => [k, current[k]])), ...patch, updated_at: new Date().toISOString() };
  const { error } = await db().from('workspace_onboarding').upsert(row, { onConflict: 'workspace_id' });
  check(error, 'save');
  return get(workspaceId);
}

function _resetMemory() { mem.clear(); }

module.exports = { get, save, _resetMemory };
