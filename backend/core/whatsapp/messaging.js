const config = require('../../config');
const activityLog = require('../activityLog');
const store = require('./store');
const { getProvider } = require('./index');
const { normalizeNumber } = require('./phone');

// The whole message must be the keyword: "cancel my order" must not unsubscribe anyone.
const STOP_WORDS = /^\s*(stop|stop all|unsubscribe|opt[ -]?out)\s*[.!]*\s*$/i;
const START_WORDS = /^\s*(start|unstop|subscribe|opt[ -]?in)\s*[.!]*\s*$/i;

const STOP_NOTICE = "You won't receive any more messages from us on WhatsApp. Reply START if you change your mind.";
const START_NOTICE = "You're subscribed again - we'll reply to your messages here. Reply STOP at any time to opt out.";

// Sends that may still reach a contact who replied STOP: the admin's own
// hand-typed reply, and the one-time STOP/START confirmation.
const ALLOWED_AFTER_STOP = new Set(['manual', 'optout_notice']);

class OptedOutError extends Error {
  constructor(contactNumber) {
    super(`${contactNumber} replied STOP, so nothing is sent automatically until they reply START.`);
    this.name = 'OptedOutError';
    this.code = 'OPTED_OUT';
  }
}

// Overridable in tests so they don't wait real seconds.
const timing = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

/** Random whole number of milliseconds between min and max. */
function randomBetween(min, max) {
  return Math.round(min + timing.random() * (max - min));
}

/**
 * Send one message and record it. With `typing`, shows "typing..." and waits a
 * random 2-6 seconds first, so a reply doesn't land the instant a message arrives.
 * Throws on a send failure (after logging); the caller decides what that means.
 */
async function sendAndRecord({ sessionName, to, text, userId = null, workspaceId = null, source, typing = false }) {
  const provider = getProvider();
  const contactNumber = normalizeNumber(to);
  if (!contactNumber) throw new Error(`Not a valid WhatsApp number: "${to}"`);
  if (!text || !String(text).trim()) throw new Error('Message text is empty');

  // Every send passes here, so no path (agent, auto-reply, outreach, alerts) can message someone who said STOP.
  if (!ALLOWED_AFTER_STOP.has(source) && (await store.isOptedOut(sessionName, contactNumber).catch(() => false))) {
    throw new OptedOutError(contactNumber);
  }

  if (typing) {
    await provider.sendTyping(sessionName, contactNumber, true);
    await timing.sleep(randomBetween(2000, 6000));
    await provider.sendTyping(sessionName, contactNumber, false);
  }

  let result;
  try {
    result = await provider.sendMessage(sessionName, contactNumber, text);
  } catch (err) {
    console.warn(`[whatsapp] send failed (${provider.name}/${sessionName} -> ${contactNumber}, ${source}): ${err.message}`);
    await activityLog.record('WhatsApp', 'send_failed', contactNumber, { session: sessionName, source, error: err.message, workspaceId }).catch(() => {});
    throw err;
  }

  await store.saveMessage({
    provider: provider.name, sessionName, userId, workspaceId, direction: 'out',
    contactNumber, text, waMessageId: result.id, source,
  }).catch((err) => console.warn(`[whatsapp] sent but not saved: ${err.message}`));
  await activityLog.record('WhatsApp', 'message_sent', contactNumber, { session: sessionName, source, workspaceId }).catch(() => {});
  console.log(`[whatsapp] sent (${provider.name}/${sessionName} -> ${contactNumber}, ${source})`);
  return result;
}

/**
 * Save an incoming message and pass it to the WhatsApp agent. "stop" (and
 * similar) records an opt-out instead, so outreach skips that contact.
 * Never throws - a webhook must always get its 200.
 */
async function handleIncomingMessage({ providerName, sessionName, userId = null, workspaceId = null, message }) {
  try {
    let isNew;
    try {
      ({ isNew } = await store.saveMessage({
        provider: providerName, sessionName, userId, workspaceId, direction: 'in',
        contactNumber: message.contactNumber, contactName: message.contactName,
        text: message.text, waMessageId: message.waMessageId, timestamp: message.timestamp, source: 'contact',
      }));
    } catch (err) {
      // e.g. migration 0005 not run yet: keep answering customers, de-duplicating the old way.
      console.warn(`[whatsapp] message not saved to whatsapp_chat_messages (${err.message}) - replying anyway`);
      ({ isNew } = await require('../../memory').recordIncomingMessage(message.waMessageId || `${message.contactNumber}:${Date.now()}`, message.contactNumber, message.text || ''));
    }
    if (!isNew) return { handled: false, reason: 'duplicate' };

    const text = message.text || '';
    const optedOut = await store.isOptedOut(sessionName, message.contactNumber);
    const notice = (body) => sendAndRecord({ sessionName, to: message.contactNumber, text: body, userId, workspaceId, source: 'optout_notice' })
      .catch((err) => console.warn(`[whatsapp] opt-out notice not sent to ${message.contactNumber}: ${err.message}`));

    if (STOP_WORDS.test(text)) {
      if (optedOut) return { handled: true, optedOut: true, reason: 'already opted out' }; // confirm only once
      await store.addOptOut(sessionName, message.contactNumber);
      await activityLog.record('WhatsApp', 'contact_opted_out', message.contactNumber, { session: sessionName, workspaceId }).catch(() => {});
      console.log(`[whatsapp] ${message.contactNumber} opted out on ${sessionName}`);
      await notice(STOP_NOTICE);
      return { handled: true, optedOut: true };
    }

    if (START_WORDS.test(text)) {
      if (optedOut) {
        await store.removeOptOut(sessionName, message.contactNumber);
        await activityLog.record('WhatsApp', 'contact_opted_in', message.contactNumber, { session: sessionName, workspaceId }).catch(() => {});
        console.log(`[whatsapp] ${message.contactNumber} opted back in on ${sessionName}`);
        await notice(START_NOTICE);
      }
      return { handled: true, optedIn: true };
    }

    // Opted out: their message is saved (it shows in the Inbox) but nothing replies automatically.
    if (optedOut) return { handled: true, routed: false, reason: 'opted out' };

    if (!text || text === '[media message]') return { handled: true, routed: false };

    // Rate limit: a contact (or another bot) can't keep the auto-reply going forever.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentReplies = await store.countSentToContact(sessionName, message.contactNumber, hourAgo, ['auto_reply']).catch(() => 0);
    if (recentReplies >= config.whatsapp.autoReplyMaxPerContactPerHour) {
      console.warn(`[whatsapp] ${message.contactNumber}: ${recentReplies} auto-replies in the last hour - not replying again (rate limit)`);
      await activityLog.record('WhatsApp', 'auto_reply_rate_limited', message.contactNumber, { session: sessionName, workspaceId }).catch(() => {});
      return { handled: true, routed: false, reason: 'rate limited' };
    }

    // Lazy require: agents/registry -> agents -> core modules would otherwise be circular.
    const agent = require('../../agents/registry').getAgent('whatsapp');
    await agent.handleIncomingMessage({
      from: message.contactNumber,
      body: text,
      workspaceId,
      session: providerName === 'waha' ? sessionName : null,
      userId,
    });
    return { handled: true, routed: true };
  } catch (err) {
    console.error(`[whatsapp] incoming message from ${message?.contactNumber} not processed: ${err.message}`);
    return { handled: false, error: err.message };
  }
}

/**
 * Record a WAHA session status change. FAILED, or STOPPED while it was linked
 * (and not by the admin pressing Disconnect), flags it for the Reconnect banner.
 */
async function handleSessionStatus({ sessionName, status, phoneNumber, pushName }) {
  try {
    const row = await store.getSessionByName(sessionName);
    if (!row) return;
    const lost = status === 'FAILED' || (status === 'STOPPED' && row.status === 'WORKING' && !row.disconnected_by_user);
    const fields = { status, last_status_at: new Date().toISOString() };
    if (status === 'WORKING') Object.assign(fields, { needs_reconnect: false, disconnected_by_user: false, last_error: null });
    if (lost) Object.assign(fields, { needs_reconnect: true, last_error: `WhatsApp session ${status.toLowerCase()}` });
    if (phoneNumber) fields.phone_number = phoneNumber;
    if (pushName) fields.push_name = pushName;
    await store.updateSession(sessionName, fields);
    if (lost) {
      console.warn(`[whatsapp] session ${sessionName} is ${status} - admin needs to reconnect`);
      await activityLog.record('WhatsApp', 'session_lost', sessionName, { status, workspaceId: row.workspace_id }).catch(() => {});
    }
  } catch (err) {
    console.error(`[whatsapp] could not record status ${status} for ${sessionName}: ${err.message}`);
  }
}

module.exports = {
  sendAndRecord, handleIncomingMessage, handleSessionStatus, randomBetween,
  STOP_WORDS, START_WORDS, STOP_NOTICE, START_NOTICE, OptedOutError, timing,
};
