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
    if (!config.notifications?.ownerWhatsappNumber) return false;
    // WAHA: alerts go out from the linked WhatsApp (needs WAHA_BASE_URL + WAHA_API_KEY).
    if (config.whatsapp?.provider === 'waha' && config.waha?.baseUrl && config.waha?.apiKey) return true;
    return !!(config.whatsapp?.accessToken || config.whatsapp?.phoneNumberId);
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

/**
 * WhatsApp alert. Your alerts (to OWNER_WHATSAPP_NUMBER) go out from your own
 * number; a client business's alerts (to its alert number) from ITS own number.
 * An alert is never sent from another business's WhatsApp.
 */
async function trySendWhatsapp(alertText, { to = null, senderWorkspaceId = null } = {}) {
  const target = to || config.notifications?.ownerWhatsappNumber || null;
  if (!to && !isChannelConfigured('whatsapp')) return 'not_configured';
  if (!target) return 'not_configured';
  try {
    await whatsappProvider.sendMessage(target, alertText, { source: 'owner_alert', ...(senderWorkspaceId ? { workspaceId: senderWorkspaceId } : {}) });
    return 'sent';
  } catch (err) {
    console.warn(`[notifications] WhatsApp alert failed: ${err.message}`);
    return `failed: ${err.message}`;
  }
}

/**
 * Who gets an alert about this business: you (the app owner - Telegram, your
 * WhatsApp, your email), or the client business itself (its alert number,
 * then its business email). A client's customer messages never go to your
 * Telegram, and yours never to a client.
 */
async function audienceFor(workspaceId) {
  const clientSettings = require('./whatsapp/clientSettings');
  const operator = await clientSettings.isOperatorWorkspace(workspaceId).catch(() => !workspaceId);
  if (operator) {
    const ownerWs = await clientSettings.operatorWorkspaceId().catch(() => null);
    return { operator: true, senderWorkspaceId: ownerWs || workspaceId || null };
  }
  const settings = await clientSettings.get(workspaceId);
  return { operator: false, alertNumber: settings.alert_number, senderWorkspaceId: workspaceId };
}

/** Send one alert to the right audience: chat first, email only if no chat channel got through. */
async function deliver({ workspaceId = null, text, subject }) {
  const a = await audienceFor(workspaceId);
  const results = { telegram: 'not_configured', whatsapp: 'not_configured', email: 'not_attempted' };
  if (a.operator) {
    results.telegram = await trySendTelegram(text);
    results.whatsapp = await trySendWhatsapp(text, { senderWorkspaceId: a.senderWorkspaceId });
  } else {
    results.telegram = 'not_used';
    results.whatsapp = a.alertNumber ? await trySendWhatsapp(text, { to: a.alertNumber, senderWorkspaceId: a.senderWorkspaceId }) : 'not_configured';
  }
  if (results.telegram !== 'sent' && results.whatsapp !== 'sent') {
    results.email = await trySendEmail({ subject, body: text, workspaceId });
  }
  return results;
}

/**
 * Email fallback for owner notifications. Routes through the Gmail guard's
 * systemDigest path, which restricts recipients to config.applicant.email -
 * so this cannot be weaponized to send to anyone else. Subject carries the
 * [CodeCraft/System] prefix so inbox triage filters recognize it as
 * app-generated mail and skips it.
 */
async function trySendEmail({ subject, body, workspaceId = null }) {
  // Phase 2.4: route to the workspace's own business_email first; fall
  // back to the legacy APPLICANT_EMAIL env for a single-tenant install.
  let to = null;
  if (workspaceId) {
    const businessProfile = require('./businessProfile');
    try { to = await businessProfile.ownerEmail(workspaceId); } catch { to = null; }
  }
  if (!to) to = config.applicant?.email || null;
  if (!to) return 'not_configured';
  try {
    const toolRegistry = require('../tools/ToolRegistry');
    if (!toolRegistry.has('gmail.sendEmail')) return 'not_configured';
    await toolRegistry.call(
      'gmail.sendEmail',
      {
        to,
        subject: `[CodeCraft/System] ${subject}`,
        body,
      },
      { role: 'notifications', systemDigest: true, workspaceId }
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
async function notifyOwnerPendingApproval({ channel, from, customerMessage, draftReply, approvalTaskId, workspaceId = null, reason = null, customerToldText = null }) {
  const alertText =
    `New ${channel} message needs your approval\n\n` +
    `From: ${from}\n` +
    (reason ? `Why: ${reason}\n` : '') +
    `Customer said: "${truncate(customerMessage)}"\n\n` +
    (customerToldText ? `They were told: "${truncate(customerToldText)}"\n\n` : '') +
    `Drafted reply: "${truncate(draftReply)}"\n\n` +
    `The customer hasn't had a reply yet. Reply to them yourself, or approve/edit Ian's suggestion on your CodeCraft Tasks page` +
    (approvalTaskId ? ` (task ${approvalTaskId}).` : '.');

  return deliver({ workspaceId, text: alertText, subject: `Approval needed - ${channel} message from ${from}` });
}

/**
 * FYI only - an auto-reply already went out, nothing to approve. Telegram only
 * (no WhatsApp or email fallback), so routine replies don't flood the owner.
 * Returns 'sent' | 'not_configured' | 'failed: ...'. Never throws.
 */
async function notifyOwnerFyi({ channel, from, customerMessage, sentReply, workspaceId = null }) {
  // Your Telegram is yours: FYIs about a client business's customers don't go there.
  if (!(await require('./whatsapp/clientSettings').isOperatorWorkspace(workspaceId).catch(() => !workspaceId))) return 'not_used';
  const text =
    `FYI - Ian replied on ${channel} (no approval needed)\n\n` +
    `From: ${from}\n` +
    `Customer said: "${truncate(customerMessage)}"\n\n` +
    `Ian replied: "${truncate(sentReply)}"`;
  return trySendTelegram(text);
}

const MEDIA_WORDS = { voice: 'a voice note', image: 'an image', sticker: 'a sticker', video: 'a video', file: 'a file' };

/**
 * A customer sent something Ian can't read (voice note, image, sticker, file).
 * Ian does NOT reply to them - the owner is asked to attend to this client.
 * Telegram and WhatsApp; email only if neither got through. Never throws.
 */
async function notifyOwnerAttention({ channel, from, contactName = null, mediaType = null, customerMessage = null, problem = null, workspaceId = null }) {
  const who = contactName ? `${contactName} (${from})` : from;
  // A text Ian couldn't answer (e.g. the AI service is down), or media he can't open.
  const what = customerMessage
    ? `${who} wrote: "${truncate(customerMessage)}"\n\n${problem || "Ian couldn't answer"}, so he hasn't replied - they're waiting for you.`
    : `${who} sent ${MEDIA_WORDS[mediaType] || "a message Ian can't read"}. Ian can't listen to or open it, so he hasn't replied - they're waiting for you.`;
  const alertText =
    `Please attend to this client on ${channel}\n\n${what}\n\n` +
    'Reply to them from your WhatsApp or from Work -> Inbox in CodeCraft.';
  return deliver({ workspaceId, text: alertText, subject: `Attend to ${channel} client ${from}` });
}

/**
 * A plain message to the business owner (hot-lead alerts, the daily summary):
 * chat first, email only if no chat channel got through. Never throws.
 */
async function notifyOwner({ subject, text, workspaceId = null }) {
  return deliver({ workspaceId, text, subject: subject || 'CodeCraft update' });
}

/** To you, the app owner, whatever business it's about (e.g. the WhatsApp server is down). */
async function notifyOperator({ subject, text }) {
  return deliver({ workspaceId: null, text, subject: subject || 'CodeCraft alert' });
}

/**
 * A linked WhatsApp number disconnected or was banned. The business is told by
 * email (its WhatsApp is the thing that's down), and you always get a copy so
 * you can help - for every client, right away.
 */
async function notifySessionLost({ sessionName, workspaceId = null, status, phoneNumber = null }) {
  const clientSettings = require('./whatsapp/clientSettings');
  const isYours = await clientSettings.isOperatorWorkspace(workspaceId).catch(() => !workspaceId);
  let business = 'Your business';
  if (workspaceId) {
    const p = await require('./businessProfile').getProfile(workspaceId).catch(() => null);
    if (p?.business_name) business = p.business_name;
  }
  const number = phoneNumber ? ` (+${phoneNumber})` : '';
  const what = status === 'FAILED'
    ? 'stopped working - WhatsApp logged it out. This can mean the number was banned or the phone unlinked it'
    : 'disconnected';
  const results = {};
  if (!isYours) {
    const text = `Your WhatsApp${number} ${what}, so your WhatsApp agent can't reply to customers right now.\n\n`
      + 'Open CodeCraft -> Toolbox -> Connections and click Connect WhatsApp to link it again. If WhatsApp says the number is banned, contact us before linking another number.';
    results.client = { email: await trySendEmail({ subject: 'Your WhatsApp is disconnected', body: text, workspaceId }) };
  }
  const opText = `${isYours ? 'Your' : `Client "${business}"`} WhatsApp${number} ${what} (session ${sessionName}). `
    + `Their customers get no replies until it's linked again${isYours ? '' : ' - they were emailed'}. Other clients are not affected.`;
  results.operator = await notifyOperator({ subject: `WhatsApp disconnected - ${business}`, text: opText });
  return results;
}

module.exports = {
  notifyOwner,
  notifyOperator,
  notifySessionLost,
  notifyOwnerPendingApproval,
  notifyOwnerAttention,
  notifyOwnerFyi,
  channelStatus,
  isChannelConfigured,
};