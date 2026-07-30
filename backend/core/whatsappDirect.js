const config = require('../config');

const API_VERSION = 'v21.0';

function assertConfigured() {
  if (!config.whatsapp.phoneNumberId || !config.whatsapp.accessToken) {
    throw new Error(
      'WhatsApp not configured - set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env'
    );
  }
}

async function graphRequest(path, options = {}) {
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
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

module.exports = { sendMessage, checkStatus };
