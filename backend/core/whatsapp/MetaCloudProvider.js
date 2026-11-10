const config = require('../../config');
const metaDirect = require('../whatsappDirect');
const { normalizeNumber } = require('./phone');

/**
 * Meta's official WhatsApp Cloud API (core/whatsappDirect.js) behind the common
 * provider interface - the "official" option (Tier 2: outreach with approved
 * templates to opted-in contacts).
 *
 * Two ways to use it:
 *   - per client business (multi-client): the business connects its own Meta
 *     number on Toolbox -> Connections (phone number id + access token, stored
 *     encrypted in workspace_connections). Its session is "meta_<phone number id>"
 *     and every send uses THAT business's own token.
 *   - legacy single number: WHATSAPP_PROVIDER=meta plus WHATSAPP_PHONE_NUMBER_ID /
 *     WHATSAPP_ACCESS_TOKEN; its session is "meta".
 *
 * Meta only delivers free-form text to people who messaged the business in the
 * last 24 hours; first messages and anything later need an approved template.
 */
const name = 'meta';
const SESSION = 'meta';
const SESSION_PREFIX = 'meta_';

const sessionNameFor = (phoneNumberId) => `${SESSION_PREFIX}${String(phoneNumberId).replace(/[^0-9a-zA-Z]/g, '')}`;
const isMetaSession = (sessionName) => sessionName === SESSION || String(sessionName || '').startsWith(SESSION_PREFIX);

function isConfigured() {
  return !!(config.whatsapp.phoneNumberId && config.whatsapp.accessToken);
}

/** The phone number id + token to use for a session. Throws when this business hasn't connected Meta. */
async function credentialsFor(sessionName) {
  if (!sessionName || sessionName === SESSION) {
    if (!isConfigured()) throw new Error('Meta WhatsApp is not configured (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).');
    return { phoneNumberId: config.whatsapp.phoneNumberId, accessToken: config.whatsapp.accessToken };
  }
  const row = await require('./store').getSessionByName(sessionName);
  if (!row?.workspace_id) throw new Error(`Unknown Meta WhatsApp number (${sessionName}).`);
  const connections = require('../workspaceConnections');
  const conn = await connections.getConnection(row.workspace_id, 'whatsapp');
  const meta = conn?.provider_meta || {};
  if (conn?.status !== 'connected' || meta.type !== 'meta' || sessionNameFor(meta.phone_number_id) !== sessionName || !meta.encrypted_access_token) {
    throw new Error('Meta WhatsApp is not connected for this business - connect it on Toolbox -> Connections.');
  }
  return { phoneNumberId: meta.phone_number_id, accessToken: connections.decrypt(meta.encrypted_access_token) };
}

async function getStatus(sessionName = SESSION) {
  if ((!sessionName || sessionName === SESSION) && !isConfigured()) return { status: 'NOT_CONFIGURED', phoneNumber: null, pushName: null };
  try {
    const creds = await credentialsFor(sessionName);
    const info = await metaDirect.checkStatusWith(creds);
    return { status: 'WORKING', phoneNumber: normalizeNumber(info?.display_phone_number || ''), pushName: info?.verified_name || 'Meta' };
  } catch (err) {
    return { status: 'FAILED', phoneNumber: null, pushName: null, error: err.message };
  }
}

async function startSession(sessionName) {
  return getStatus(sessionName);
}

async function getQR() {
  return null; // the number is registered in Meta's developer console, not with a QR code
}

async function sendMessage(sessionName, to, text) {
  const digits = normalizeNumber(to);
  if (!digits) throw new Error(`Not a valid WhatsApp number: "${to}"`);
  const json = await metaDirect.sendTextWith(await credentialsFor(sessionName), digits, text);
  return { id: json?.messages?.[0]?.id || null };
}

/** An approved template: { name, language, params: [...] }. */
async function sendTemplate(sessionName, to, template) {
  const digits = normalizeNumber(to);
  if (!digits) throw new Error(`Not a valid WhatsApp number: "${to}"`);
  if (!template?.name) throw new Error('Choose an approved template to send.');
  const json = await metaDirect.sendTemplateWith(await credentialsFor(sessionName), digits, template);
  return { id: json?.messages?.[0]?.id || null };
}

async function sendImage() {
  throw new Error('Sending photos needs the WAHA WhatsApp connection');
}

async function sendTyping() {
  // The Cloud API's typing indicator needs the incoming message id; the caller's delay still applies.
}

async function disconnect() {
  // Nothing to unlink here: remove the Meta connection on Toolbox -> Connections.
}

/**
 * Meta's webhook body -> list of messages in the shared shape, each tagged with
 * the phone number id it arrived on. Meta batches, so this returns
 * { type: 'messages', messages: [...] } (possibly empty).
 */
function handleIncomingWebhook(req) {
  const messages = [];
  const phoneNumberIds = {}; // waMessageId -> the business number it arrived on (kept out of the shared message shape)
  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || null;
      const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name || null]));
      for (const msg of value.messages || []) {
        if (msg.type !== 'text') continue;
        const contactNumber = normalizeNumber(msg.from);
        if (!contactNumber) continue;
        if (phoneNumberId) phoneNumberIds[msg.id] = phoneNumberId;
        messages.push({
          waMessageId: msg.id,
          lid: null,
          mediaType: null,
          mediaUrl: null,
          mediaMime: null, // media detection is WAHA-only for now
          contactNumber,
          contactName: names[msg.from] || null,
          text: msg.text?.body || '',
          timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  }
  return { type: 'messages', sessionName: SESSION, messages, phoneNumberIds };
}

/** The owner of a workspace (session rows need an admin). */
async function workspaceOwnerId(workspaceId) {
  if (process.env.CC_FORCE_MEMORY_STORE === '1' || !config.supabase.url || !config.supabase.serviceKey) return null;
  const sb = require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey);
  const { data } = await sb.from('workspaces').select('owner_user_id').eq('id', workspaceId).maybeSingle();
  return data?.owner_user_id || null;
}

/**
 * Make sure a business's Meta number has its session row ("meta_<phone number id>"),
 * so the Inbox, limits, opt-outs and the Clients page treat it like any other number.
 */
async function ensureSession(workspaceId, conn) {
  const meta = conn?.provider_meta || {};
  if (!workspaceId || meta.type !== 'meta' || !meta.phone_number_id) return null;
  const store = require('./store');
  const sessionName = sessionNameFor(meta.phone_number_id);
  const existing = await store.getSessionByName(sessionName);
  if (existing && existing.workspace_id && existing.workspace_id !== workspaceId) {
    throw new Error(`Meta number ${meta.phone_number_id} is already connected to another business.`);
  }
  if (existing && existing.status === 'WORKING') return existing;
  return store.upsertSession({
    session_name: sessionName,
    user_id: existing?.user_id || (await workspaceOwnerId(workspaceId).catch(() => null)),
    workspace_id: workspaceId,
    status: conn.status === 'connected' ? 'WORKING' : 'STOPPED',
    phone_number: normalizeNumber(meta.display_phone || '') || null,
    push_name: meta.verified_name || null,
    needs_reconnect: false,
    disconnected_by_user: false,
    last_error: null,
  });
}

/** Meta signs webhooks with your app secret (X-Hub-Signature-256). Checked when META_APP_SECRET is set. */
function verifySignature(req) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true;
  const header = String(req.headers['x-hub-signature-256'] || '');
  if (!header.startsWith('sha256=') || !req.rawBody) return false;
  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

module.exports = {
  name, SESSION, SESSION_PREFIX, sessionNameFor, isMetaSession, credentialsFor, ensureSession, verifySignature,
  isConfigured, startSession, getQR, getStatus, sendMessage, sendTemplate, sendImage, sendTyping, disconnect, handleIncomingWebhook,
};
