const config = require('../../config');

/**
 * The WhatsApp provider in use, chosen by WHATSAPP_PROVIDER ("waha" default, or "twilio").
 *
 * Both implement the same interface:
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
  return config.whatsapp.provider === 'twilio' ? require('./TwilioProvider') : require('./WahaProvider');
}

/** WAHA session name for an admin: letters, digits and underscores only. */
function sessionNameForUser(userId) {
  return `admin_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** Where WAHA should POST incoming messages, or null when the backend's public URL is unknown. */
function webhookUrl() {
  return config.waha.publicBackendUrl ? `${config.waha.publicBackendUrl}/api/webhooks/whatsapp` : null;
}

module.exports = { getProvider, sessionNameForUser, webhookUrl };
