const config = require('../config');
const twilio = require('./whatsappTwilio');
const metaDirect = require('./whatsappDirect');

/**
 * Entry point for code that just wants to "send a WhatsApp" (owner alerts,
 * briefings, the whatsapp.sendMessage tool). Routes through the provider
 * chosen by WHATSAPP_PROVIDER (core/whatsapp), and always from the RIGHT number:
 *
 *   - opts.session given: that number (core/whatsapp/messaging refuses it if it
 *     belongs to another business than opts.workspaceId);
 *   - opts.workspaceId given: that business's own linked number (WAHA or its
 *     own Meta number). If it has none, nothing is sent - it never borrows
 *     another business's WhatsApp;
 *   - neither (your own system alerts): the single shared session in
 *     single-number mode, else WA_ALERT_SESSION, else your own workspace's number.
 *
 *   twilio / meta (WHATSAPP_PROVIDER, one shared number from the env vars): as before.
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

const NO_NUMBER = "This business has no WhatsApp number linked (or it's disconnected) - connect it on Toolbox -> Connections. Nothing was sent.";

/**
 * Which number to send from. Throws instead of guessing - a message must never
 * go out from someone else's WhatsApp.
 */
async function pickSession({ session, workspaceId }, providerName) {
  if (session) return session;
  const store = require('./whatsapp/store');
  if (workspaceId) {
    const own = (await store.listWorkingSessions(workspaceId))[0];
    if (own) return own.session_name;
    // Single-number installs from before workspaces: the shared session has no business attached yet.
    if (providerName === 'waha' && !config.waha.multiSession) {
      const shared = await store.getSessionByName(config.waha.sessionName).catch(() => null);
      if (shared && !shared.workspace_id) return shared.session_name;
    }
    return null;
  }
  if (providerName !== 'waha') return null;
  if (!config.waha.multiSession) return config.waha.sessionName;
  if (process.env.WA_ALERT_SESSION) return process.env.WA_ALERT_SESSION.trim();
  const ownerWs = await require('./whatsapp/clientSettings').operatorWorkspaceId();
  const own = ownerWs ? (await store.listWorkingSessions(ownerWs))[0] : null;
  return own ? own.session_name : null;
}

/**
 * @param {string} to - phone number
 * @param {string} body - message text
 * @param {{session?: string, workspaceId?: string, userId?: string, source?: string, typing?: boolean, template?: object}} [opts]
 */
async function sendMessage(to, body, opts = {}) {
  const provider = activeProvider();
  const sessionName = await pickSession(opts, provider?.name || config.whatsapp.provider);

  if (sessionName) {
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
      template: opts.template || null,
    });
  }
  if (!provider) {
    throw new Error(
      config.whatsapp.provider === 'waha'
        ? 'WhatsApp (WAHA) not configured - set WAHA_BASE_URL and WAHA_API_KEY, or set WHATSAPP_PROVIDER=twilio to use Twilio.'
        : 'WhatsApp not configured - set either TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (recommended, no ' +
          'business verification needed), or WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN for direct Meta.'
    );
  }
  if (provider.name === 'waha') {
    throw new Error(opts.workspaceId ? NO_NUMBER : 'No WhatsApp number is set for alerts - link your own WhatsApp, or set WA_ALERT_SESSION. Nothing was sent.');
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

module.exports = { sendMessage, checkStatus, activeProvider, pickSession };
