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
 * Channel status is tracked explicitly: callers always get back a
 * per-channel result of 'sent' | 'not_configured' | 'failed: <reason>'. The
 * module NEVER reports a channel as 'sent' when it has no credentials for
 * that channel - stale fabricated success would mask a silent outage.
 *
 * Email is used as a fallback (via the Gmail guard's systemDigest path,
 * which is restricted to the configured owner address) when every chat
 * channel is either unconfigured or failed. This keeps owner notifications
 * reaching you while WhatsApp and Telegram remain future integrations.
 *
 * Never throws - a notification failure must never break the actual
 * customer-facing flow that triggered it.
 */

function truncate(text, max = 300) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function isChannelConfigured(channel) {
  if (channel === 'telegram') {
    return !!(config.notifications?.ownerTelegramChatId && config.telegram?.botToken);
  }
  if (channel === 'whatsapp') {
    return !!(config.notifications?.ownerWhatsappNumber && (config.whatsapp?.accessToken || config.whatsapp?.phoneNumberId));
  }
  if (channel === 'email') {
    return !!(config.applicant?.email);
  }
  return false;
}

function channelStatus() {
  return {
    telegram: isChannelConfigured('telegram') ? 'configured' : 'not_configured',
    whatsapp: isChannelConfigured('whatsapp') ? 'configured' : 'not_configured',
    email: isChannelConfigured('email') ? 'configured' : 'not_configured',
  };
}

async function trySendTelegram(alertText) {
  if (!isChannelConfigured('telegram')) return 'not_configured';
  try {
    await telegramProvider.sendMessage(config.notifications.ownerTelegramChatId, alertText);
    return 'sent';
  } catch (err) {
    console.warn(`[notifications] owner Telegram alert failed: ${err.message}`);
    return `failed: ${err.message}`;
  }
}

async function trySendWhatsapp(alertText) {
  if (!isChannelConfigured('whatsapp')) return 'not_configured';
  try {
    await whatsappProvider.sendMessage(config.notifications.ownerWhatsappNumber, alertText);
    return 'sent';
  } catch (err) {
    console.warn(`[notifications] owner WhatsApp alert failed: ${err.message}`);
    return `failed: ${err.message}`;
  }
}

/**
 * Email fallback for owner notifications. Routes through the Gmail guard's
 * systemDigest path, which restricts recipients to config.applicant.email -
 * so this cannot be weaponized to send to anyone else. Subject carries the
 * [CodeCraft/System] prefix so inbox triage filters recognize it as
 * app-generated mail and skips it.
 */
async function trySendEmail({ subject, body }) {
  if (!isChannelConfigured('email')) return 'not_configured';
  try {
    const toolRegistry = require('../tools/ToolRegistry');
    if (!toolRegistry.has('gmail.sendEmail')) return 'not_configured';
    await toolRegistry.call(
      'gmail.sendEmail',
      {
        to: config.applicant.email,
        subject: `[CodeCraft/System] ${subject}`,
        body,
      },
      { role: 'notifications', systemDigest: true }
    );
    return 'sent';
  } catch (err) {
    console.warn(`[notifications] owner email fallback failed: ${err.message}`);
    return `failed: ${err.message}`;
  }
}

/**
 * Sent only when an incoming customer message did NOT auto-send (either
 * auto-reply is off for that channel, or the safety classifier judged it
 * needs a human) - i.e. exactly the messages sitting in the Tasks page
 * waiting on you.
 *
 * Returns a per-channel results object. Email is only attempted when every
 * chat channel is unconfigured or failed, so a working Telegram/WhatsApp
 * channel is still preferred (less inbox noise).
 */
async function notifyOwnerPendingApproval({ channel, from, customerMessage, draftReply, approvalTaskId }) {
  const alertText =
    `New ${channel} message needs your approval\n\n` +
    `From: ${from}\n` +
    `Customer said: "${truncate(customerMessage)}"\n\n` +
    `Drafted reply: "${truncate(draftReply)}"\n\n` +
    `Approve or edit it on your CodeCraft Tasks page` +
    (approvalTaskId ? ` (task ${approvalTaskId}).` : '.');

  const results = {
    telegram: await trySendTelegram(alertText),
    whatsapp: await trySendWhatsapp(alertText),
    email: 'not_attempted',
  };

  const chatDeliveredOrPending = results.telegram === 'sent' || results.whatsapp === 'sent';
  if (!chatDeliveredOrPending) {
    results.email = await trySendEmail({
      subject: `Approval needed - ${channel} message from ${from}`,
      body: alertText,
    });
  }

  return results;
}

module.exports = {
  notifyOwnerPendingApproval,
  channelStatus,
  isChannelConfigured,
};