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

/** Providers with one shared business number instead of a linked phone per admin. */
function isSharedNumberProvider(name = config.whatsapp.provider) {
  return name === 'twilio' || name === 'meta';
}

/** WAHA session name for an admin: letters, digits and underscores only. */
function sessionNameForUser(userId) {
  return `admin_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** Where WAHA should POST incoming messages, or null when the backend's public URL is unknown. */
function webhookUrl() {
  return config.waha.publicBackendUrl ? `${config.waha.publicBackendUrl}/api/webhooks/whatsapp` : null;
}

module.exports = { getProvider, isSharedNumberProvider, sessionNameForUser, webhookUrl };
