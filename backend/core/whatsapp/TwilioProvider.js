const config = require('../../config');
const twilio = require('../whatsappTwilio');
const { normalizeNumber } = require('./phone');

/**
 * The existing Twilio WhatsApp code (core/whatsappTwilio.js) behind the common
 * provider interface. Twilio has no QR code or per-admin session: the account
 * in TWILIO_* env vars is the one "session". Missing Twilio env vars only make
 * the calls report "not configured" - they never crash the server.
 */
const name = 'twilio';
const SESSION = 'twilio';

function isConfigured() {
  return !!(config.twilio.accountSid && config.twilio.authToken);
}

async function getStatus() {
  if (!isConfigured()) return { status: 'NOT_CONFIGURED', phoneNumber: null, pushName: null };
  try {
    await twilio.checkStatus();
    return { status: 'WORKING', phoneNumber: normalizeNumber(config.twilio.whatsappFrom), pushName: 'Twilio' };
  } catch (err) {
    return { status: 'FAILED', phoneNumber: null, pushName: null, error: err.message };
  }
}

async function startSession() {
  return getStatus();
}

async function getQR() {
  return null; // Twilio is linked in the Twilio console, not with a QR code
}

async function sendMessage(_sessionName, to, text) {
  const digits = normalizeNumber(to);
  if (!digits) throw new Error(`Not a valid WhatsApp number: "${to}"`);
  const json = await twilio.sendMessage(`+${digits}`, text);
  return { id: json?.sid || null };
}

async function sendTyping() {
  // Twilio has no typing indicator - the caller's delay still applies.
}

async function disconnect() {
  // Nothing to unlink: remove the TWILIO_* env vars to stop using Twilio.
}

/** Twilio's form-encoded webhook -> the same message shape WAHA produces. */
function handleIncomingWebhook(req) {
  const { MessageSid, From, Body, ProfileName } = req.body || {};
  if (!MessageSid || !From) return { type: 'ignored', reason: 'not a Twilio message' };
  const contactNumber = normalizeNumber(From);
  if (!contactNumber) return { type: 'ignored', reason: 'unreadable sender number' };
  return {
    type: 'message',
    sessionName: SESSION,
    message: {
      waMessageId: MessageSid,
      lid: null,
      contactNumber,
      contactName: ProfileName || null,
      text: Body || '',
      timestamp: new Date().toISOString(),
    },
  };
}

module.exports = { name, SESSION, isConfigured, startSession, getQR, getStatus, sendMessage, sendTyping, disconnect, handleIncomingWebhook };
