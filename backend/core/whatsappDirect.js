const config = require('../config');

const API_VERSION = 'v21.0';

function assertConfigured() {
  if (!config.whatsapp.phoneNumberId || !config.whatsapp.accessToken) {
    throw new Error(
      'WhatsApp not configured - set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env'
    );
  }
}

async function graphRequest(path, options = {}, token = config.whatsapp.accessToken) {
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `WhatsApp API error (HTTP ${res.status})`);
  }
  return json;
}

/** Sends a free-form text message. Only delivers if the recipient messaged within the last 24h. */
async function sendMessage(to, body) {
  require('./sendGuard').assertRealSendsAllowed('WhatsApp (Meta Direct)');
  assertConfigured();
  return graphRequest(`/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });
}

/** Lightweight connectivity check - fetches the connected number's own display info. */
async function checkStatus() {
  assertConfigured();
  return graphRequest(`/${config.whatsapp.phoneNumberId}?fields=display_phone_number,verified_name`);
}

// ---- One client business's own Meta number: { phoneNumberId, accessToken } ----

/** Free-form text (only delivers within 24 hours of the customer's last message). */
async function sendTextWith(creds, to, body) {
  require('./sendGuard').assertRealSendsAllowed('WhatsApp (Meta Cloud API)');
  return graphRequest(`/${creds.phoneNumberId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  }, creds.accessToken);
}

/**
 * An approved template - the only thing Meta allows as a first message or
 * outside the 24-hour window. template = { name, language, params: [text, ...] }.
 */
async function sendTemplateWith(creds, to, template) {
  require('./sendGuard').assertRealSendsAllowed('WhatsApp (Meta Cloud API)');
  const params = (template.params || []).map((text) => ({ type: 'text', text: String(text) }));
  return graphRequest(`/${creds.phoneNumberId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language || 'en' },
        ...(params.length ? { components: [{ type: 'body', parameters: params }] } : {}),
      },
    }),
  }, creds.accessToken);
}

async function checkStatusWith(creds) {
  return graphRequest(`/${creds.phoneNumberId}?fields=display_phone_number,verified_name`, {}, creds.accessToken);
}

module.exports = { sendMessage, checkStatus, sendTextWith, sendTemplateWith, checkStatusWith };
