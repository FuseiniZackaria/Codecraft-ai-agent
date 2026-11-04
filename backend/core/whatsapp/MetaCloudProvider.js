const config = require('../../config');
const metaDirect = require('../whatsappDirect');
const { normalizeNumber } = require('./phone');

/**
 * Meta's official WhatsApp Cloud API (core/whatsappDirect.js) behind the common
 * provider interface - the "official" option for paying clients. Set
 * WHATSAPP_PROVIDER=meta plus WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN /
 * WHATSAPP_WEBHOOK_VERIFY_TOKEN; incoming messages arrive on /webhooks/whatsapp.
 *
 * Like Twilio there's no QR code or per-admin session: the business number in
 * the env vars is the one "session". Meta only delivers free-form text to people
 * who messaged the business in the last 24 hours (templates are needed after that).
 */
const name = 'meta';
const SESSION = 'meta';

function isConfigured() {
  return !!(config.whatsapp.phoneNumberId && config.whatsapp.accessToken);
}

async function getStatus() {
  if (!isConfigured()) return { status: 'NOT_CONFIGURED', phoneNumber: null, pushName: null };
  try {
    const info = await metaDirect.checkStatus();
    return { status: 'WORKING', phoneNumber: normalizeNumber(info?.display_phone_number || ''), pushName: info?.verified_name || 'Meta' };
  } catch (err) {
    return { status: 'FAILED', phoneNumber: null, pushName: null, error: err.message };
  }
}

async function startSession() {
  return getStatus();
}

async function getQR() {
  return null; // the number is registered in Meta's developer console, not with a QR code
}

async function sendMessage(_sessionName, to, text) {
  const digits = normalizeNumber(to);
  if (!digits) throw new Error(`Not a valid WhatsApp number: "${to}"`);
  const json = await metaDirect.sendMessage(digits, text);
  return { id: json?.messages?.[0]?.id || null };
}

async function sendTyping() {
  // The Cloud API's typing indicator needs the incoming message id; the caller's delay still applies.
}

async function disconnect() {
  // Nothing to unlink: remove the WHATSAPP_* env vars to stop using Meta.
}

/**
 * Meta's webhook body -> list of messages in the shared shape. Meta batches,
 * so this returns { type: 'messages', messages: [...] } (possibly empty).
 */
function handleIncomingWebhook(req) {
  const messages = [];
  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name || null]));
      for (const msg of value.messages || []) {
        if (msg.type !== 'text') continue;
        const contactNumber = normalizeNumber(msg.from);
        if (!contactNumber) continue;
        messages.push({
          waMessageId: msg.id,
          lid: null,
          contactNumber,
          contactName: names[msg.from] || null,
          text: msg.text?.body || '',
          timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  }
  return { type: 'messages', sessionName: SESSION, messages };
}

module.exports = { name, SESSION, isConfigured, startSession, getQR, getStatus, sendMessage, sendTyping, disconnect, handleIncomingWebhook };
