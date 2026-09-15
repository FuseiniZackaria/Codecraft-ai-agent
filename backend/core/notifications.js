const config = require('../config');
const telegramProvider = require('./telegramProvider');
const whatsappProvider = require('./whatsappProvider');

/**
 * notifications.js - alerts sent directly TO THE OWNER, not to any
 * customer or third party. This deliberately does NOT go through the
 * approval-gate system (createApprovalTask/approveTask) that every other
 * outward-facing action in this codebase uses - that gate exists to make
 * sure a human signs off before the AI acts on their behalf toward someone
 * else. Notifying the human themselves doesn't fit that purpose; requiring
 * the owner to "approve" an alert before they're allowed to see it would be
 * circular and pointless, not safer.
 *
 * Never throws - a notification failure must never break the actual
 * customer-facing flow that triggered it. Failures are logged and
 * swallowed by the caller (see TelegramAgent/WhatsAppAgent).
 */

function truncate(text, max = 300) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Sent only when an incoming customer message did NOT auto-send (either
 * auto-reply is off for that channel, or the safety classifier judged it
 * needs a human) - i.e. exactly the messages sitting in the Tasks page
 * waiting on you.
 *
 * @param {object} params
 * @param {string} params.channel - 'telegram' | 'whatsapp' (which channel the customer message came in on)
 * @param {string} params.from - the customer's chat id / phone number
 * @param {string} params.customerMessage
 * @param {string} params.draftReply
 * @param {string} params.approvalTaskId
 */
async function notifyOwnerPendingApproval({ channel, from, customerMessage, draftReply, approvalTaskId }) {
  const alertText =
    `🔔 New ${channel} message needs your approval\n\n` +
    `From: ${from}\n` +
    `Customer said: "${truncate(customerMessage)}"\n\n` +
    `Drafted reply: "${truncate(draftReply)}"\n\n` +
    `Approve or edit it on your CodeCraft Tasks page.`;

  const results = { telegram: null, whatsapp: null };

  if (config.notifications.ownerTelegramChatId) {
    try {
      await telegramProvider.sendMessage(config.notifications.ownerTelegramChatId, alertText);
      results.telegram = 'sent';
    } catch (err) {
      results.telegram = `failed: ${err.message}`;
      console.warn(`[notifications] owner Telegram alert failed: ${err.message}`);
    }
  }

  if (config.notifications.ownerWhatsappNumber) {
    try {
      await whatsappProvider.sendMessage(config.notifications.ownerWhatsappNumber, alertText);
      results.whatsapp = 'sent';
    } catch (err) {
      results.whatsapp = `failed: ${err.message}`;
      console.warn(`[notifications] owner WhatsApp alert failed: ${err.message}`);
    }
  }

  return results;
}

module.exports = { notifyOwnerPendingApproval };