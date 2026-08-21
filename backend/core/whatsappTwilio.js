const config = require('../config');

function assertConfigured() {
  if (!config.twilio.accountSid || !config.twilio.authToken) {
    throw new Error('Twilio not configured - set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env');
  }
}

function basicAuthHeader() {
  const encoded = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Normalizes a plain number ("+233..." or "233...") to Twilio's required
 * "whatsapp:+E164" form. Leaves an already-prefixed value alone.
 */
function toWhatsAppAddress(number) {
  if (number.startsWith('whatsapp:')) return number;
  const cleaned = number.startsWith('+') ? number : `+${number}`;
  return `whatsapp:${cleaned}`;
}

/**
 * Sends a WhatsApp message via Twilio's Programmable Messaging API.
 * Uses the shared Sandbox number by default - the recipient must have
 * texted "join <your sandbox keyword>" to it first, same 24h-adjacent
 * opt-in concept as Meta's direct API, just far faster to set up (no
 * business verification needed for sandbox use).
 */
async function sendMessage(to, body) {
  assertConfigured();

  const params = new URLSearchParams({
    Body: body,
    From: config.twilio.whatsappFrom,
    To: toWhatsAppAddress(to),
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.message || `Twilio API error (HTTP ${res.status})`);
  }
  return json;
}

/** Lightweight connectivity check - fetches the account's own info to confirm the credentials work. */
async function checkStatus() {
  assertConfigured();
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}.json`, {
    headers: { Authorization: basicAuthHeader() },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.message || `Twilio API error (HTTP ${res.status})`);
  }
  return json;
}

module.exports = { sendMessage, checkStatus, toWhatsAppAddress };
