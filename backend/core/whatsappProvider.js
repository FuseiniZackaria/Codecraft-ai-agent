const config = require('../config');
const twilio = require('./whatsappTwilio');
const metaDirect = require('./whatsappDirect');

/**
 * Entry point for code that just wants to "send a WhatsApp" (owner alerts,
 * briefings, the whatsapp.sendMessage tool). Routes through the provider
 * chosen by WHATSAPP_PROVIDER (core/whatsapp):
 *
 *   waha   - sends from a linked WAHA session: the one named in opts.session,
 *            else a working session in opts.workspaceId, else any working one.
 *   twilio - the original behaviour: Twilio when TWILIO_* is set, otherwise
 *            Meta's direct API when WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN are.
 *   meta   - Meta's official WhatsApp Cloud API only.
 */
function activeProvider() {
  if (config.whatsapp.provider === 'waha') {
    return config.waha.baseUrl ? { name: 'waha', client: null } : null;
  }
  if (config.whatsapp.provider === 'meta') {
    return config.whatsapp.phoneNumberId && config.whatsapp.accessToken ? { name: 'meta', client: metaDirect } : null;
  }
  if (config.twilio.accountSid && config.twilio.authToken) return { name: 'twilio', client: twilio };
  if (config.whatsapp.phoneNumberId && config.whatsapp.accessToken) return { name: 'meta', client: metaDirect };
  return null;
}

async function pickWahaSession({ session, workspaceId }) {
  if (session) return session;
  const store = require('./whatsapp/store');
  const working = (workspaceId && (await store.listWorkingSessions(workspaceId))) || [];
  const pick = working[0] || (await store.listWorkingSessions())[0];
  if (!pick) throw new Error('No WhatsApp account is linked - an admin needs to connect WhatsApp on the Connections page.');
  return pick.session_name;
}

/**
 * @param {string} to - phone number
 * @param {string} body - message text
 * @param {{session?: string, workspaceId?: string, userId?: string, source?: string, typing?: boolean}} [opts]
 */
async function sendMessage(to, body, opts = {}) {
  const provider = activeProvider();
  if (!provider) {
    throw new Error(
      config.whatsapp.provider === 'waha'
        ? 'WhatsApp (WAHA) not configured - set WAHA_BASE_URL and WAHA_API_KEY, or set WHATSAPP_PROVIDER=twilio to use Twilio.'
        : 'WhatsApp not configured - set either TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (recommended, no ' +
          'business verification needed), or WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN for direct Meta.'
    );
  }
  if (provider.name === 'waha') {
    const sessionName = await pickWahaSession(opts);
    const store = require('./whatsapp/store');
    const owner = await store.getSessionByName(sessionName).catch(() => null);
    return require('./whatsapp/messaging').sendAndRecord({
      sessionName,
      to,
      text: body,
      userId: opts.userId || owner?.user_id || null,
      workspaceId: opts.workspaceId || owner?.workspace_id || null,
      source: opts.source || 'agent',
      typing: !!opts.typing,
      image: opts.image || null,
      linkPreview: !!opts.linkPreview,
    });
  }
  if (opts.image) throw new Error('Sending photos needs the WAHA WhatsApp connection');
  return provider.client.sendMessage(to, body);
}

async function checkStatus() {
  const provider = activeProvider();
  if (!provider) return { connected: false, error: 'No WhatsApp provider configured' };
  try {
    if (provider.name === 'waha') {
      const store = require('./whatsapp/store');
      const working = await store.listWorkingSessions();
      return working.length
        ? { connected: true, provider: 'waha', sessions: working.length }
        : { connected: false, provider: 'waha', error: 'No WhatsApp account linked yet' };
    }
    await provider.client.checkStatus();
    return { connected: true, provider: provider.name };
  } catch (err) {
    return { connected: false, provider: provider.name, error: err.message };
  }
}

module.exports = { sendMessage, checkStatus, activeProvider };
