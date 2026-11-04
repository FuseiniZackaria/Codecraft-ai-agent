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

const mem = { sessions: [], messages: [], outbox: [], optouts: [] };
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

async function getSessionByUser(userId) {
  if (!db()) return mem.sessions.find((s) => s.user_id === userId) || null;
  const { data, error } = await db().from('whatsapp_sessions').select('*').eq('user_id', userId).maybeSingle();
  check(error, 'getSessionByUser');
  return data;
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
  const { data, error } = await db().from('whatsapp_sessions').update(patch).eq('session_name', sessionName).select().maybeSingle();
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
  return m.user_id === userId || (!m.user_id && ['twilio', 'meta'].includes(m.provider) && workspaceId && m.workspace_id === workspaceId);
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
}

module.exports = {
  getSessionByUser, getSessionByName, upsertSession, updateSession, listWorkingSessions,
  saveMessage, listConversations, listMessages,
  isOptedOut, addOptOut, removeOptOut, hasMessagedFirst, countSentToContact,
  enqueueOutreach, nextQueuedPerSession, updateOutbox, countSentToday, listOutbox,
  _resetMemory,
};
