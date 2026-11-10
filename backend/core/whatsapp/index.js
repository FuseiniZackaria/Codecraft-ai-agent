const config = require('../../config');

/**
 * The WhatsApp provider in use, chosen by WHATSAPP_PROVIDER:
 *   "waha"   (default) self-hosted WhatsApp Web, one linked phone per admin
 *   "twilio" Twilio's WhatsApp API
 *   "meta"   Meta's official WhatsApp Cloud API (for paying clients)
 * Everything else in the app talks to this interface only, so switching is a
 * settings change, not a rewrite.
 *
 * All implement the same interface:
 *   startSession(sessionName, { webhookUrl, metadata }) -> { status, phoneNumber, pushName }
 *   getQR(sessionName)                    -> data: URL image, or null
 *   getStatus(sessionName)                -> { status, phoneNumber, pushName }
 *   sendMessage(sessionName, to, text)    -> { id }
 *   sendTyping(sessionName, to, on)       -> never throws
 *   disconnect(sessionName)
 *   handleIncomingWebhook(req)            -> { type: 'message'|'status'|'ignored'|'rejected', ... }
 *   isConfigured()
 */
function getProvider() {
  if (config.whatsapp.provider === 'twilio') return require('./TwilioProvider');
  if (config.whatsapp.provider === 'meta') return require('./MetaCloudProvider');
  return require('./WahaProvider');
}

/**
 * The provider for ONE session (number): "meta" / "meta_<id>" -> Meta Cloud API
 * (that business's own credentials), "twilio" -> Twilio, anything else -> WAHA.
 * Lets WAHA clients and Meta clients run side by side.
 */
function getProviderForSession(sessionName) {
  const s = String(sessionName || '');
  if (s === 'meta' || s.startsWith('meta_')) return require('./MetaCloudProvider');
  if (s === 'twilio') return require('./TwilioProvider');
  if (!s) return getProvider();
  return require('./WahaProvider');
}

/** Providers with one shared business number instead of a linked phone per admin. */
function isSharedNumberProvider(name = config.whatsapp.provider) {
  return name === 'twilio' || name === 'meta';
}

/**
 * WAHA session an admin uses. Single-session mode (default): the one shared
 * WAHA_SESSION_NAME ("default"). WAHA_MULTI_SESSION=true: their own
 * "admin_<user id>" (letters, digits and underscores only).
 */
function sessionNameForUser(userId) {
  if (!config.waha.multiSession) return config.waha.sessionName;
  return `admin_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** Where WAHA should POST incoming messages, or null when the backend's public URL is unknown. */
function webhookUrl() {
  return config.waha.publicBackendUrl ? `${config.waha.publicBackendUrl}/api/webhooks/whatsapp` : null;
}

/**
 * Can this person link WhatsApp? Single-session WAHA (e.g. the Core tier) has
 * room for ONE number: only the app owner (APP_OWNER_EMAIL) or whoever already
 * holds the session may connect; everyone else is told it isn't available yet.
 * No owner email configured = first come, first served (the old rule).
 */
async function canConnectWhatsapp(user) {
  const provider = getProvider();
  if (config.waha.multiSession || provider.name !== 'waha') return true;
  const ownerEmail = String(process.env.APP_OWNER_EMAIL || config.applicant?.email || '').toLowerCase();
  if (!ownerEmail) return true;
  if (String(user?.email || '').toLowerCase() === ownerEmail) return true;
  const row = await require('./store').getSessionByName(sessionNameForUser(user?.id)).catch(() => null);
  return !!row && row.user_id === user?.id;
}

module.exports = { getProvider, getProviderForSession, isSharedNumberProvider, sessionNameForUser, webhookUrl, canConnectWhatsapp };
