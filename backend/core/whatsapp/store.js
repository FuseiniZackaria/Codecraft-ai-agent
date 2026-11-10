const crypto = require('crypto');
const config = require('../../config');

/**
 * Storage for the WhatsApp tables (migration 0005_whatsapp_waha.sql):
 *   whatsapp_sessions       one WAHA session per admin
 *   whatsapp_chat_messages  every incoming/outgoing message, same shape for WAHA and Twilio
 *   whatsapp_outbox         the outreach send queue
 *   whatsapp_optouts        contacts who replied "stop"
 *
 * Supabase when configured, otherwise in memory (tests, local runs without a
 * database). Every function throws a clear error on a database failure; callers
 * catch it so a WhatsApp problem never takes the server down.
 */

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}

const mem = { sessions: [], messages: [], outbox: [], optouts: [], consent: [] };
const now = () => new Date().toISOString();

function check(error, where) {
  if (error) throw new Error(`whatsapp store (${where}): ${error.message}`);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ---------- sessions ----------

/**
 * The session this admin uses (the shared one in single-session mode, their own
 * with WAHA_MULTI_SESSION=true) - but only if they are the one who connected it.
 */
async function getSessionByUser(userId) {
  const { sessionNameForUser } = require('./index');
  const row = await getSessionByName(sessionNameForUser(userId));
  return row && row.user_id === userId ? row : null;
}

async function getSessionByName(sessionName) {
  if (!db()) return mem.sessions.find((s) => s.session_name === sessionName) || null;
  const { data, error } = await db().from('whatsapp_sessions').select('*').eq('session_name', sessionName).maybeSingle();
  check(error, 'getSessionByName');
  return data;
}

/** Create or update the admin's session row (keyed by session_name). */
async function upsertSession(row) {
  const full = { ...row, updated_at: now() };
  if (!db()) {
    const i = mem.sessions.findIndex((s) => s.session_name === row.session_name);
    if (i >= 0) mem.sessions[i] = { ...mem.sessions[i], ...full };
    else mem.sessions.push({ created_at: now(), needs_reconnect: false, ...full });
    return mem.sessions.find((s) => s.session_name === row.session_name);
  }
  const { data, error } = await db().from('whatsapp_sessions').upsert(full, { onConflict: 'session_name' }).select().single();
  check(error, 'upsertSession');
  return data;
}

async function updateSession(sessionName, fields) {
  const patch = { ...fields, updated_at: now() };
  if (!db()) {
    const s = mem.sessions.find((x) => x.session_name === sessionName);
    if (s) Object.assign(s, patch);
    return s || null;
  }
  let { data, error } = await db().from('whatsapp_sessions').update(patch).eq('session_name', sessionName).select().maybeSingle();
  // Migration 0010 not run yet: save everything except its new columns.
  if (error && /linked_at|lost_alerted_at/.test(error.message)) {
    const { linked_at, lost_alerted_at, ...rest } = patch; // eslint-disable-line no-unused-vars
    ({ data, error } = await db().from('whatsapp_sessions').update(rest).eq('session_name', sessionName).select().maybeSingle());
  }
  check(error, 'updateSession');
  return data;
}

/** Sessions that are linked and working - optionally only one workspace's. */
async function listWorkingSessions(workspaceId = null) {
  if (!db()) return mem.sessions.filter((s) => s.status === 'WORKING' && (!workspaceId || s.workspace_id === workspaceId));
  let q = db().from('whatsapp_sessions').select('*').eq('status', 'WORKING');
  if (workspaceId) q = q.eq('workspace_id', workspaceId);
  const { data, error } = await q;
  check(error, 'listWorkingSessions');
  return data || [];
}

/**
 * The one WhatsApp number of a business (workspace): its working session if
 * there is one, else its most recently updated one. Never another business's.
 */
async function getSessionForWorkspace(workspaceId) {
  if (!workspaceId) return null;
  const rows = db()
    ? await (async () => {
      const { data, error } = await db().from('whatsapp_sessions').select('*').eq('workspace_id', workspaceId);
      check(error, 'getSessionForWorkspace');
      return data || [];
    })()
    : mem.sessions.filter((s) => s.workspace_id === workspaceId);
  if (!rows.length) return null;
  const rank = (s) => (s.status === 'WORKING' ? 2 : s.disconnected_by_user ? 0 : 1);
  return [...rows].sort((a, b) => rank(b) - rank(a) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
}

/** Every session row (all businesses) - for the app owner's Clients page and health checks. */
async function listSessions() {
  if (!db()) return mem.sessions.map((s) => ({ ...s }));
  const { data, error } = await db().from('whatsapp_sessions').select('*');
  check(error, 'listSessions');
  return data || [];
}

// ---------- messages ----------

/**
 * Save one message. Returns { isNew: false } when this provider message id
 * was already saved (webhooks can be delivered twice).
 */
async function saveMessage(msg) {
  const row = {
    id: crypto.randomUUID(),
    provider: msg.provider,
    session_name: msg.sessionName || null,
    user_id: msg.userId || null,
    workspace_id: msg.workspaceId || null,
    direction: msg.direction, // 'in' | 'out'
    contact_number: msg.contactNumber,
    contact_name: msg.contactName || null,
    body: msg.text || '',
    wa_message_id: msg.waMessageId || null,
    source: msg.source || null, // 'contact' | 'auto_reply' | 'manual' | 'outreach' | 'agent'
    sent_at: msg.timestamp || now(),
    created_at: now(),
  };
  if (!db()) {
    if (row.wa_message_id && mem.messages.some((m) => m.wa_message_id === row.wa_message_id)) return { isNew: false };
    mem.messages.push(row);
    return { isNew: true, message: row };
  }
  const { error } = await db().from('whatsapp_chat_messages').insert(row);
  if (error && /duplicate key/i.test(error.message)) return { isNew: false };
  check(error, 'saveMessage');
  return { isNew: true, message: row };
}

/** Messages an admin may see: their own session's, plus workspace-level Twilio/Meta messages (shared business number). */
function visibleTo(m, { userId, workspaceId }) {
  return (!!userId && m.user_id === userId) || (!m.user_id && ['twilio', 'meta'].includes(m.provider) && workspaceId && m.workspace_id === workspaceId);
}

async function recentMessagesFor(viewer, limit = 1000) {
  if (!db()) {
    return mem.messages.filter((m) => visibleTo(m, viewer)).sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1)).slice(0, limit);
  }
  let q = db().from('whatsapp_chat_messages').select('*').order('sent_at', { ascending: false }).limit(limit);
  q = viewer.workspaceId
    ? q.or(`user_id.eq.${viewer.userId},and(user_id.is.null,provider.in.(twilio,meta),workspace_id.eq.${viewer.workspaceId})`)
    : q.eq('user_id', viewer.userId);
  const { data, error } = await q;
  check(error, 'recentMessagesFor');
  return data || [];
}

/** One row per contact, newest conversation first. */
async function listConversations(viewer) {
  const byContact = new Map();
  for (const m of await recentMessagesFor(viewer)) {
    const c = byContact.get(m.contact_number);
    if (!c) {
      byContact.set(m.contact_number, {
        contactNumber: m.contact_number,
        contactName: m.contact_name,
        lastMessage: m.body,
        lastDirection: m.direction,
        lastAt: m.sent_at,
        unanswered: m.direction === 'in',
      });
    } else if (!c.contactName && m.contact_name) {
      c.contactName = m.contact_name;
    }
  }
  return [...byContact.values()];
}

/** One message by id - only if this viewer may see it (else null). */
async function getMessage(viewer, id) {
  if (!id) return null;
  if (!db()) {
    const m = mem.messages.find((x) => x.id === id);
    return m && visibleTo(m, viewer) ? { ...m } : null;
  }
  const { data, error } = await db().from('whatsapp_chat_messages').select('*').eq('id', id).maybeSingle();
  if (error && /invalid input syntax for type uuid/i.test(error.message)) return null;
  check(error, 'getMessage');
  return data && visibleTo(data, viewer) ? data : null;
}

async function listMessages(viewer, contactNumber, limit = 200) {
  const all = db()
    ? await (async () => {
      let q = db().from('whatsapp_chat_messages').select('*').eq('contact_number', contactNumber).order('sent_at', { ascending: false }).limit(limit);
      q = viewer.workspaceId
        ? q.or(`user_id.eq.${viewer.userId},and(user_id.is.null,provider.in.(twilio,meta),workspace_id.eq.${viewer.workspaceId})`)
        : q.eq('user_id', viewer.userId);
      const { data, error } = await q;
      check(error, 'listMessages');
      return data || [];
    })()
    : mem.messages.filter((m) => m.contact_number === contactNumber && visibleTo(m, viewer)).sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1)).slice(0, limit);
  return all.reverse(); // oldest first for display
}

/** One number's conversation with one contact (oldest first) - the history Ian reads before replying. */
async function listSessionMessages(sessionName, contactNumber, limit = 12) {
  if (!sessionName) return [];
  if (!db()) {
    return mem.messages.filter((m) => m.session_name === sessionName && m.contact_number === contactNumber)
      .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1)).slice(0, limit).reverse();
  }
  const { data, error } = await db().from('whatsapp_chat_messages').select('*')
    .eq('session_name', sessionName).eq('contact_number', contactNumber).order('sent_at', { ascending: false }).limit(limit);
  check(error, 'listSessionMessages');
  return (data || []).reverse();
}

/** Messages this number sent today, optionally only some sources (e.g. ['auto_reply']). */
async function countSentBySessionToday(sessionName, sources = null) {
  const since = startOfToday();
  if (!db()) {
    return mem.messages.filter((m) => m.session_name === sessionName && m.direction === 'out' && m.sent_at >= since
      && (!sources || sources.includes(m.source))).length;
  }
  let q = db().from('whatsapp_chat_messages').select('id', { count: 'exact', head: true })
    .eq('session_name', sessionName).eq('direction', 'out').gte('sent_at', since);
  if (sources) q = q.in('source', sources);
  const { count, error } = await q;
  check(error, 'countSentBySessionToday');
  return count || 0;
}

/** Messages received by this number today. */
async function countReceivedToday(sessionName) {
  const since = startOfToday();
  if (!db()) return mem.messages.filter((m) => m.session_name === sessionName && m.direction === 'in' && m.sent_at >= since).length;
  const { count, error } = await db().from('whatsapp_chat_messages').select('id', { count: 'exact', head: true })
    .eq('session_name', sessionName).eq('direction', 'in').gte('sent_at', since);
  check(error, 'countReceivedToday');
  return count || 0;
}

/** When this contact last messaged this number (ISO), or null. Meta's 24-hour window starts here. */
async function lastInboundAt(sessionName, contactNumber) {
  if (!db()) {
    const times = mem.messages.filter((m) => m.session_name === sessionName && m.contact_number === contactNumber && m.direction === 'in').map((m) => m.sent_at).sort();
    return times[times.length - 1] || null;
  }
  const { data, error } = await db().from('whatsapp_chat_messages').select('sent_at')
    .eq('session_name', sessionName).eq('contact_number', contactNumber).eq('direction', 'in')
    .order('sent_at', { ascending: false }).limit(1).maybeSingle();
  check(error, 'lastInboundAt');
  return data?.sent_at || null;
}

// ---------- opt-ins (Meta outreach) ----------

async function addConsent(workspaceId, numbers, { source = 'import', note = null, userId = null } = {}) {
  const rows = [...new Set(numbers)].map((n) => ({ workspace_id: workspaceId, contact_number: n, source, note, created_by: userId, created_at: now() }));
  if (!rows.length) return 0;
  if (!db()) {
    for (const r of rows) if (!mem.consent.some((c) => c.workspace_id === workspaceId && c.contact_number === r.contact_number)) mem.consent.push(r);
    return rows.length;
  }
  const { error } = await db().from('whatsapp_consent').upsert(rows, { onConflict: 'workspace_id,contact_number' });
  check(error, 'addConsent');
  return rows.length;
}

async function hasConsent(workspaceId, contactNumber) {
  if (!workspaceId) return false;
  if (!db()) return mem.consent.some((c) => c.workspace_id === workspaceId && c.contact_number === contactNumber);
  const { data, error } = await db().from('whatsapp_consent').select('contact_number').eq('workspace_id', workspaceId).eq('contact_number', contactNumber).maybeSingle();
  if (error && /does not exist|schema cache/i.test(error.message)) return false;
  check(error, 'hasConsent');
  return !!data;
}

async function countConsent(workspaceId) {
  if (!db()) return mem.consent.filter((c) => c.workspace_id === workspaceId).length;
  const { count, error } = await db().from('whatsapp_consent').select('contact_number', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
  if (error && /does not exist|schema cache/i.test(error.message)) return 0;
  check(error, 'countConsent');
  return count || 0;
}

// ---------- opt-outs ----------

async function isOptedOut(sessionName, contactNumber) {
  if (!db()) return mem.optouts.some((o) => o.session_name === sessionName && o.contact_number === contactNumber);
  const { data, error } = await db().from('whatsapp_optouts').select('contact_number').eq('session_name', sessionName).eq('contact_number', contactNumber).maybeSingle();
  check(error, 'isOptedOut');
  return !!data;
}

async function addOptOut(sessionName, contactNumber, reason = 'replied stop') {
  if (!db()) {
    if (!mem.optouts.some((o) => o.session_name === sessionName && o.contact_number === contactNumber)) {
      mem.optouts.push({ session_name: sessionName, contact_number: contactNumber, reason, created_at: now() });
    }
    return;
  }
  const { error } = await db().from('whatsapp_optouts').upsert(
    { session_name: sessionName, contact_number: contactNumber, reason, created_at: now() },
    { onConflict: 'session_name,contact_number' }
  );
  check(error, 'addOptOut');
}

/** "START" after "STOP": the contact may be messaged again. */
async function removeOptOut(sessionName, contactNumber) {
  if (!db()) {
    const i = mem.optouts.findIndex((o) => o.session_name === sessionName && o.contact_number === contactNumber);
    if (i >= 0) mem.optouts.splice(i, 1);
    return;
  }
  const { error } = await db().from('whatsapp_optouts').delete().eq('session_name', sessionName).eq('contact_number', contactNumber);
  check(error, 'removeOptOut');
}

// ---------- consent and rate limits ----------

/** True when this contact has messaged this WhatsApp number at least once (consent for outreach). */
async function hasMessagedFirst(sessionName, contactNumber) {
  if (!db()) return mem.messages.some((m) => m.session_name === sessionName && m.contact_number === contactNumber && m.direction === 'in');
  const { count, error } = await db().from('whatsapp_chat_messages').select('id', { count: 'exact', head: true })
    .eq('session_name', sessionName).eq('contact_number', contactNumber).eq('direction', 'in');
  check(error, 'hasMessagedFirst');
  return (count || 0) > 0;
}

/** Messages sent to one contact since `sinceIso`, optionally only from some sources (e.g. ['auto_reply']). */
async function countSentToContact(sessionName, contactNumber, sinceIso, sources = null) {
  if (!db()) {
    return mem.messages.filter((m) => m.session_name === sessionName && m.contact_number === contactNumber && m.direction === 'out'
      && m.sent_at >= sinceIso && (!sources || sources.includes(m.source))).length;
  }
  let q = db().from('whatsapp_chat_messages').select('id', { count: 'exact', head: true })
    .eq('session_name', sessionName).eq('contact_number', contactNumber).eq('direction', 'out').gte('sent_at', sinceIso);
  if (sources) q = q.in('source', sources);
  const { count, error } = await q;
  check(error, 'countSentToContact');
  return count || 0;
}

// ---------- outbox ----------

async function enqueueOutreach(rows) {
  const full = rows.map((r) => ({
    id: crypto.randomUUID(),
    session_name: r.sessionName,
    user_id: r.userId || null,
    workspace_id: r.workspaceId || null,
    contact_number: r.contactNumber,
    body: r.text,
    ...(r.template ? { template: r.template } : {}), // column from migration 0010; only sent when used
    status: 'queued',
    created_at: now(),
    updated_at: now(),
  }));
  if (!full.length) return [];
  if (!db()) {
    mem.outbox.push(...full);
    return full;
  }
  const { error } = await db().from('whatsapp_outbox').insert(full);
  check(error, 'enqueueOutreach');
  return full;
}

/** Oldest queued item per session (the worker sends one per session at a time). */
async function nextQueuedPerSession() {
  const queued = db()
    ? await (async () => {
      const { data, error } = await db().from('whatsapp_outbox').select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(500);
      check(error, 'nextQueuedPerSession');
      return data || [];
    })()
    : mem.outbox.filter((o) => o.status === 'queued').sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const first = new Map();
  for (const o of queued) if (!first.has(o.session_name)) first.set(o.session_name, o);
  return [...first.values()];
}

async function updateOutbox(id, fields) {
  const patch = { ...fields, updated_at: now() };
  if (!db()) {
    const o = mem.outbox.find((x) => x.id === id);
    if (o) Object.assign(o, patch);
    return;
  }
  const { error } = await db().from('whatsapp_outbox').update(patch).eq('id', id);
  check(error, 'updateOutbox');
}

async function countSentToday(sessionName) {
  const since = startOfToday();
  if (!db()) return mem.outbox.filter((o) => o.session_name === sessionName && o.status === 'sent' && o.sent_at >= since).length;
  const { count, error } = await db().from('whatsapp_outbox').select('id', { count: 'exact', head: true })
    .eq('session_name', sessionName).eq('status', 'sent').gte('sent_at', since);
  check(error, 'countSentToday');
  return count || 0;
}

/** What this number queued or sent since `sinceIso` (for spotting copy-paste messages). */
async function listRecentOutboxBodies(sessionName, sinceIso) {
  if (!db()) {
    return mem.outbox.filter((o) => o.session_name === sessionName && o.created_at >= sinceIso && ['queued', 'sending', 'sent'].includes(o.status)).map((o) => o.body);
  }
  const { data, error } = await db().from('whatsapp_outbox').select('body')
    .eq('session_name', sessionName).in('status', ['queued', 'sending', 'sent']).gte('created_at', sinceIso).limit(500);
  check(error, 'listRecentOutboxBodies');
  return (data || []).map((o) => o.body);
}

async function listOutbox(userId, limit = 100) {
  if (!db()) return mem.outbox.filter((o) => o.user_id === userId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);
  const { data, error } = await db().from('whatsapp_outbox').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  check(error, 'listOutbox');
  return data || [];
}

/** Test hook. */
function _resetMemory() {
  mem.sessions.length = 0;
  mem.messages.length = 0;
  mem.outbox.length = 0;
  mem.optouts.length = 0;
  mem.consent.length = 0;
}

module.exports = {
  getSessionByUser, getSessionByName, upsertSession, updateSession, listWorkingSessions, getSessionForWorkspace, listSessions,
  saveMessage, listConversations, listMessages, getMessage, listSessionMessages,
  countSentBySessionToday, countReceivedToday, lastInboundAt,
  addConsent, hasConsent, countConsent,
  isOptedOut, addOptOut, removeOptOut, hasMessagedFirst, countSentToContact,
  enqueueOutreach, nextQueuedPerSession, updateOutbox, countSentToday, listOutbox, listRecentOutboxBodies,
  _resetMemory,
};
