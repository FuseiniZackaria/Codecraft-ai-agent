const config = require('../../config');
const { normalizeNumber } = require('./phone');

/**
 * Per-client WhatsApp settings (migration 0010, table whatsapp_client_settings).
 * One row per workspace (= one client business):
 *
 *   tier               'reply_only' (Tier 1: only answers people who messaged
 *                      first, no outreach at all) | 'outreach' (may contact
 *                      people first, within the outreach rules)
 *   channel            'waha' (linked phone, QR) | 'meta' (official Cloud API)
 *   auto_reply         this number replies automatically (null = WA_AUTO_REPLY)
 *   alert_number       where this business's own alerts go on WhatsApp
 *   place              town for the time of day in replies (null = WA_PLACE / Ghana)
 *   language           'english' | 'match' | 'local' (see LANGUAGE_RULES)
 *   daily_reply_limit  automatic replies per day from this number
 *   warmup_days        lower outreach limits for this long after linking
 *   meta_templates     approved Meta templates [{ name, language, params, body }]
 *
 * No row yet: the app owner's own workspace (APP_OWNER_EMAIL) gets 'outreach'
 * (how it has always worked); every other business starts as 'reply_only'.
 */

const TIERS = ['reply_only', 'outreach'];
const CHANNELS = ['waha', 'meta'];
const LANGUAGES = ['english', 'match', 'local'];

const LANGUAGE_RULES = {
  english: 'Always reply in English, even if the customer writes in Twi, Pidgin, Ga, Ewe or another language.',
  match: 'Reply in English. If the customer writes in Twi, Pidgin, Ga or Ewe, you may answer in the same language or mix in a little of it, the way people in Ghana chat - never more than they use.',
  local: 'Many customers write in Twi, Pidgin, Ga or Ewe: reply in the language they use, naturally, the way people in Ghana chat. Use English when they write in English.',
};

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}

const mem = new Map(); // workspaceId -> row
const cache = new Map(); // workspaceId -> { row, at }
const persisting = new Set(); // operator workspaces whose default row is being saved
const CACHE_MS = 30 * 1000;
let warnedMissing = false;

function missingTable(error) {
  return /does not exist|schema cache/i.test(error?.message || '');
}

/** Test hook: which workspace is the app owner's (undefined = work it out). */
const testing = { operatorWorkspaceId: undefined };

/**
 * Is this the app owner's (your) own workspace - or no workspace at all?
 * No APP_OWNER_EMAIL / no database = a single-business install: yes.
 * Owner lookup failing = only "no workspace" counts (fails closed).
 */
async function isOperatorWorkspace(workspaceId) {
  if (testing.operatorWorkspaceId !== undefined) {
    return testing.operatorWorkspaceId === null || !workspaceId || workspaceId === testing.operatorWorkspaceId;
  }
  if (!workspaceId) return true;
  const ownerEmail = process.env.APP_OWNER_EMAIL || config.applicant?.email || '';
  if (!ownerEmail || !db()) return true;
  const ownerWs = await require('../workspaceContext').getAppOwnerWorkspaceId().catch(() => null);
  return !!ownerWs && workspaceId === ownerWs;
}

/** The app owner's workspace id (null when unknown). */
async function operatorWorkspaceId() {
  if (testing.operatorWorkspaceId !== undefined) return testing.operatorWorkspaceId;
  if (!db()) return null;
  return require('../workspaceContext').getAppOwnerWorkspaceId().catch(() => null);
}

async function readRow(workspaceId) {
  if (!db()) return mem.get(workspaceId) || null;
  const { data, error } = await db().from('whatsapp_client_settings').select('*').eq('workspace_id', workspaceId).maybeSingle();
  if (error) {
    if (missingTable(error)) {
      if (!warnedMissing) {
        warnedMissing = true;
        console.warn('[whatsapp] whatsapp_client_settings is missing - run backend/database/migrations/0010_multi_client.sql (using defaults until then)');
      }
      return null;
    }
    throw new Error(`client settings: ${error.message}`);
  }
  return data;
}

/** Settings for one workspace, with every default filled in. Never throws. */
async function get(workspaceId) {
  // Only the saved row is cached; defaults from the server settings are read fresh every time.
  const hit = workspaceId && cache.get(workspaceId);
  let row = null;
  if (hit && Date.now() - hit.at < CACHE_MS) row = hit.row;
  else if (workspaceId) {
    try {
      row = await readRow(workspaceId);
      cache.set(workspaceId, { row, at: Date.now() });
    } catch (err) { console.warn(`[whatsapp] ${err.message}`); }
  }
  const operator = await isOperatorWorkspace(workspaceId).catch(() => false);
  // Your own workspace: save its row once, so a later owner-lookup hiccup can
  // never make your number reply-only for a moment.
  if (operator && workspaceId && !row && db() && !persisting.has(workspaceId)) {
    persisting.add(workspaceId);
    save(workspaceId, { tier: 'outreach', warmup_days: 0 }).catch(() => {}); // once per server start (e.g. before migration 0010)
  }
  const value = {
    workspace_id: workspaceId || null,
    saved: !!row,
    operator,
    tier: TIERS.includes(row?.tier) ? row.tier : (operator ? 'outreach' : 'reply_only'),
    channel: CHANNELS.includes(row?.channel) ? row.channel : 'waha',
    auto_reply: typeof row?.auto_reply === 'boolean' ? row.auto_reply : config.whatsapp.autoReply,
    alert_number: row?.alert_number || null,
    place: row?.place || process.env.WA_PLACE || 'Ghana',
    language: LANGUAGES.includes(row?.language) ? row.language : 'match',
    daily_reply_limit: Number(row?.daily_reply_limit) > 0 ? Number(row.daily_reply_limit) : config.autoReply.dailyLimitPerChannel,
    // Your own long-used number doesn't warm up; a client's newly linked one does (14 days).
    warmup_days: row && row.warmup_days !== null && Number.isFinite(Number(row.warmup_days)) ? Math.max(0, Number(row.warmup_days)) : (operator ? 0 : 14),
    meta_templates: Array.isArray(row?.meta_templates) ? row.meta_templates : [],
  };
  return value;
}

/** Who may change what: the business itself sets its own alerts and language; tiers, channel and limits are yours. */
const CLIENT_FIELDS = ['auto_reply', 'alert_number', 'place', 'language'];
const OPERATOR_FIELDS = [...CLIENT_FIELDS, 'tier', 'channel', 'daily_reply_limit', 'warmup_days', 'meta_templates'];

/** Check a change. Returns { patch, fieldErrors, errors }. */
function validate(body = {}, { allowed = CLIENT_FIELDS } = {}) {
  const patch = {};
  const fieldErrors = {};
  const has = (k) => allowed.includes(k) && Object.prototype.hasOwnProperty.call(body, k);

  if (has('tier')) {
    if (!TIERS.includes(body.tier)) fieldErrors.tier = 'Choose Reply only or Outreach.';
    else patch.tier = body.tier;
  }
  if (has('channel')) {
    if (!CHANNELS.includes(body.channel)) fieldErrors.channel = 'Choose WAHA (linked phone) or Meta (official API).';
    else patch.channel = body.channel;
  }
  if (has('auto_reply')) {
    if (body.auto_reply === null || typeof body.auto_reply === 'boolean') patch.auto_reply = body.auto_reply;
    else fieldErrors.auto_reply = 'Turn automatic replies on or off.';
  }
  if (has('alert_number')) {
    const raw = String(body.alert_number || '').trim();
    if (!raw) patch.alert_number = null;
    else {
      const n = normalizeNumber(raw);
      if (!n || n.length < 9 || n.length > 15) fieldErrors.alert_number = 'Enter a WhatsApp number with the country code, e.g. 233201234567.';
      else patch.alert_number = n;
    }
  }
  if (has('place')) {
    const p = String(body.place || '').trim();
    if (p.length > 60) fieldErrors.place = 'Keep the town or city under 60 characters.';
    else patch.place = p || null;
  }
  if (has('language')) {
    if (!LANGUAGES.includes(body.language)) fieldErrors.language = 'Choose one of the language options.';
    else patch.language = body.language;
  }
  if (has('daily_reply_limit')) {
    const v = body.daily_reply_limit;
    if (v === null || v === '') patch.daily_reply_limit = null;
    else if (!Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > 1000) fieldErrors.daily_reply_limit = 'Use a whole number from 1 to 1000 (or leave it empty for the default).';
    else patch.daily_reply_limit = Number(v);
  }
  if (has('warmup_days')) {
    const v = Number(body.warmup_days);
    if (!Number.isInteger(v) || v < 0 || v > 60) fieldErrors.warmup_days = 'Use a whole number of days from 0 to 60.';
    else patch.warmup_days = v;
  }
  if (has('meta_templates')) {
    const list = Array.isArray(body.meta_templates) ? body.meta_templates : null;
    if (!list || list.length > 50) fieldErrors.meta_templates = 'Add at most 50 templates.';
    else {
      const clean = [];
      list.forEach((t, i) => {
        const name = String(t?.name || '').trim();
        const language = String(t?.language || 'en').trim();
        const params = Number(t?.params || 0);
        if (!/^[a-z0-9_]{1,512}$/.test(name)) fieldErrors.meta_templates = `Template ${i + 1}: the name must be the exact Meta template name (lowercase letters, numbers and _).`;
        else if (!/^[a-zA-Z_]{2,10}$/.test(language)) fieldErrors.meta_templates = `Template ${i + 1}: the language code looks wrong (e.g. en, en_US).`;
        else if (!Number.isInteger(params) || params < 0 || params > 10) fieldErrors.meta_templates = `Template ${i + 1}: variables must be a number from 0 to 10.`;
        else clean.push({ name, language, params, body: String(t?.body || '').slice(0, 1024) });
      });
      if (!fieldErrors.meta_templates) patch.meta_templates = clean;
    }
  }
  return { patch, fieldErrors, errors: Object.values(fieldErrors) };
}

/** Save a change (validated by the caller). Returns the full settings. */
async function save(workspaceId, patch, { userId = null } = {}) {
  if (!workspaceId) throw new Error('client settings: a workspace is required');
  const row = { workspace_id: workspaceId, ...patch, updated_at: new Date().toISOString(), updated_by: userId || null };
  if (!db()) {
    mem.set(workspaceId, { ...(mem.get(workspaceId) || {}), ...row });
  } else {
    const { error } = await db().from('whatsapp_client_settings').upsert(row, { onConflict: 'workspace_id' });
    if (error) {
      if (missingTable(error)) {
        const err = new Error('Client settings need the 0010 migration - run backend/database/migrations/0010_multi_client.sql in Supabase.');
        err.code = 'MIGRATION_MISSING';
        throw err;
      }
      throw new Error(`client settings: ${error.message}`);
    }
  }
  cache.delete(workspaceId);
  return get(workspaceId);
}

/** First time a client links WhatsApp: write their row so the tier is fixed (reply-only for clients). */
async function ensureRow(workspaceId, { userId = null } = {}) {
  if (!workspaceId) return null;
  try {
    const current = await readRow(workspaceId);
    if (current) return current;
    const s = await get(workspaceId);
    return save(workspaceId, { tier: s.tier, channel: s.channel, warmup_days: s.warmup_days }, { userId });
  } catch (err) {
    console.warn(`[whatsapp] couldn't save default client settings for ${workspaceId}: ${err.message}`);
    return null;
  }
}

/**
 * Outreach limit for one number today. New numbers warm up: 5 a day for the
 * first 3 days, 10 until day 7, 15 until the warm-up ends, then DAILY_WA_LIMIT.
 */
function outreachLimitFor(session, settings, now = Date.now()) {
  const full = config.whatsapp.dailyLimit;
  const days = settings?.warmup_days ?? 14;
  if (!session?.linked_at || days <= 0) return { limit: full, warmingUp: false };
  const day = Math.floor((now - new Date(session.linked_at).getTime()) / 86400000);
  if (day >= days) return { limit: full, warmingUp: false };
  const step = day < 3 ? 5 : day < 7 ? 10 : 15;
  return { limit: Math.min(full, step), warmingUp: true, day: day + 1, of: days };
}

function invalidate(workspaceId) {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

function _reset() {
  mem.clear();
  cache.clear();
  testing.operatorWorkspaceId = undefined;
}

module.exports = {
  get, save, validate, ensureRow, isOperatorWorkspace, operatorWorkspaceId, outreachLimitFor, invalidate,
  TIERS, CHANNELS, LANGUAGES, LANGUAGE_RULES, CLIENT_FIELDS, OPERATOR_FIELDS, testing, _reset,
};
