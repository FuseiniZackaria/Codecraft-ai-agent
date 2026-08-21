const config = require('../config');
const twilio = require('./whatsappTwilio');
const metaDirect = require('./whatsappDirect');

/**
 * Twilio is preferred when configured - far simpler setup (sandbox works in
 * minutes, no business verification). Meta direct stays available as a
 * fallback for anyone who already completed Meta's business verification.
 */
function activeProvider() {
  if (config.twilio.accountSid && config.twilio.authToken) return { name: 'twilio', client: twilio };
  if (config.whatsapp.phoneNumberId && config.whatsapp.accessToken) return { name: 'meta', client: metaDirect };
  return null;
}

async function sendMessage(to, body) {
  const provider = activeProvider();
  if (!provider) {
    throw new Error(
      'WhatsApp not configured - set either TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (recommended, no ' +
      'business verification needed), or WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN for direct Meta.'
    );
  }
  return provider.client.sendMessage(to, body);
}

async function checkStatus() {
  const provider = activeProvider();
  if (!provider) return { connected: false, error: 'No WhatsApp provider configured' };
  try {
    await provider.client.checkStatus();
    return { connected: true, provider: provider.name };
  } catch (err) {
    return { connected: false, provider: provider.name, error: err.message };
  }
}

module.exports = { sendMessage, checkStatus, activeProvider };
