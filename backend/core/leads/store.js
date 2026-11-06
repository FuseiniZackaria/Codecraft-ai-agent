const crypto = require('crypto');
const config = require('../../config');

/**
 * Storage for leads and lead settings (migration 0008_leads.sql), per
 * workspace. Supabase when configured, otherwise in memory (tests).
 */

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}

const mem = { leads: [], settings: [] };
const now = () => new Date().toISOString();

function check(error, where) {
  if (!error) return;
  if (/does not exist|schema cache/i.test(error.message)) {
    const err = new Error('The leads tables are missing - run backend/database/migrations/0008_leads.sql in Supabase (SQL Editor).');
    err.code = 'MIGRATION_MISSING';
    throw err;
  }
  throw new Error(`leads store (${where}): ${error.message}`);
}
function requireWs(ws) {
  if (!ws) throw new Error('leads store: a workspaceId is required');
}

const FIELDS = ['source', 'external_key', 'session_name', 'user_id', 'contact_number', 'contact_name', 'name', 'business_type', 'need',
  'budget', 'timeline', 'location', 'status', 'status_set_by', 'summary', 'notes', 'last_message_at', 'last_inbound_at',
  'last_outbound_at', 'followups_sent', 'last_followup_at', 'hot_alerted_at'];
const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => FIELDS.includes(k) && v !== undefined));

async function listLeads(workspaceId, { limit = 2000 } = {}) {
  requireWs(workspaceId);
  if (!db()) {
    return mem.leads.filter((l) => l.workspace_id === workspaceId)
      .sort((a, b) => String(b.last_message_at || b.created_at).localeCompare(String(a.last_message_at || a.created_at)))
      .slice(0, limit).map((l) => ({ ...l }));
  }
  const { data, error } = await db().from('leads').select('*').eq('workspace_id', workspaceId)
    .order('last_message_at', { ascending: false, nullsFirst: false }).limit(limit);
  check(error, 'listLeads');
  return data || [];
}

async function getLead(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) { const l = mem.leads.find((x) => x.workspace_id === workspaceId && x.id === id); return l ? { ...l } : null; }
  const { data, error } = await db().from('leads').select('*').eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  check(error, 'getLead');
  return data;
}

async function findByNumber(workspaceId, contactNumber) {
  requireWs(workspaceId);
  if (!db()) {
    const l = mem.leads.find((x) => x.workspace_id === workspaceId && x.source === 'whatsapp' && x.contact_number === contactNumber);
    return l ? { ...l } : null;
  }
  const { data, error } = await db().from('leads').select('*').eq('workspace_id', workspaceId).eq('source', 'whatsapp')
    .eq('contact_number', contactNumber).maybeSingle();
  check(error, 'findByNumber');
  return data;
}

async function findScraped(workspaceId, key) {
  requireWs(workspaceId);
  if (!db()) {
    const l = mem.leads.find((x) => x.workspace_id === workspaceId && x.source === 'scraped' && x.external_key === key);
    return l ? { ...l } : null;
  }
  const { data, error } = await db().from('leads').select('*').eq('workspace_id', workspaceId).eq('source', 'scraped')
    .eq('external_key', key).maybeSingle();
  check(error, 'findScraped');
  return data;
}

async function createLead(workspaceId, fields) {
  requireWs(workspaceId);
  const row = { workspace_id: workspaceId, source: 'whatsapp', status: 'new', status_set_by: 'ian', followups_sent: 0, ...pick(fields) };
  if (!db()) {
    const saved = { id: crypto.randomUUID(), created_at: now(), updated_at: now(), ...row };
    mem.leads.push(saved);
    return { ...saved };
  }
  const { data, error } = await db().from('leads').insert(row).select('*').single();
  if (error && /duplicate key/i.test(error.message) && row.source === 'whatsapp') return findByNumber(workspaceId, row.contact_number);
  check(error, 'createLead');
  return data;
}

async function updateLead(workspaceId, id, fields) {
  requireWs(workspaceId);
  const patch = { ...pick(fields), updated_at: now() };
  if (!db()) {
    const l = mem.leads.find((x) => x.workspace_id === workspaceId && x.id === id);
    if (!l) return null;
    Object.assign(l, patch);
    return { ...l };
  }
  const { data, error } = await db().from('leads').update(patch).eq('workspace_id', workspaceId).eq('id', id).select('*').maybeSingle();
  check(error, 'updateLead');
  return data;
}

/** Every workspace that has WhatsApp leads (for the follow-up / summary scheduler). */
async function workspacesWithLeads() {
  if (!db()) return [...new Set(mem.leads.map((l) => l.workspace_id))];
  const { data, error } = await db().from('leads').select('workspace_id').eq('source', 'whatsapp').limit(5000);
  check(error, 'workspacesWithLeads');
  return [...new Set((data || []).map((r) => r.workspace_id))];
}

// ---------- settings ----------

const DEFAULT_SETTINGS = {
  followups_enabled: true, ask_before_followup: true, first_followup_days: 2, second_followup_days: 5,
  daily_summary: true, summary_hour: 19, last_summary_on: null,
};
const SETTING_FIELDS = Object.keys(DEFAULT_SETTINGS);

async function getSettings(workspaceId) {
  requireWs(workspaceId);
  if (!db()) {
    const s = mem.settings.find((x) => x.workspace_id === workspaceId);
    return { ...DEFAULT_SETTINGS, ...(s || {}), workspace_id: workspaceId };
  }
  const { data, error } = await db().from('lead_settings').select('*').eq('workspace_id', workspaceId).maybeSingle();
  check(error, 'getSettings');
  return { ...DEFAULT_SETTINGS, ...(data || {}), workspace_id: workspaceId };
}

async function saveSettings(workspaceId, fields) {
  requireWs(workspaceId);
  const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => SETTING_FIELDS.includes(k)));
  if (!db()) {
    let s = mem.settings.find((x) => x.workspace_id === workspaceId);
    if (!s) { s = { workspace_id: workspaceId }; mem.settings.push(s); }
    Object.assign(s, patch, { updated_at: now() });
    return getSettings(workspaceId);
  }
  const { error } = await db().from('lead_settings').upsert({ workspace_id: workspaceId, ...patch, updated_at: now() }, { onConflict: 'workspace_id' });
  check(error, 'saveSettings');
  return getSettings(workspaceId);
}

function _resetMemory() {
  mem.leads = [];
  mem.settings = [];
}

module.exports = {
  listLeads, getLead, findByNumber, findScraped, createLead, updateLead, workspacesWithLeads,
  getSettings, saveSettings, DEFAULT_SETTINGS, _resetMemory,
};
