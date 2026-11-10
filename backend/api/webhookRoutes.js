const express = require('express');
const config = require('../config');
const memory = require('../memory');
const { getAgent } = require('../agents/registry');
const connections = require('../core/workspaceConnections');
const TwilioProvider = require('../core/whatsapp/TwilioProvider');
const MetaCloudProvider = require('../core/whatsapp/MetaCloudProvider');
const whatsappMessaging = require('../core/whatsapp/messaging');

const router = express.Router();

// ===================== HELPERS =====================

async function resolveWorkspaceFromWebhookToken(provider, webhookToken) {
  if (!webhookToken) return null;
  const conn = await connections.findByWebhookToken(provider, webhookToken);
  if (!conn || conn.status !== 'connected') return null;
  return conn.workspace_id;
}

async function legacyWorkspaceId() {
  const { getSoleWorkspaceId } = require('../core/workspaceContext');
  return getSoleWorkspaceId();
}

// ===================== WHATSAPP =====================

// Meta verification handshake - workspace-scoped
router.get('/whatsapp/:webhookToken', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe') return res.sendStatus(403);

  const conn = await connections.findByWebhookToken('whatsapp', req.params.webhookToken);
  if (!conn || conn.provider_meta?.webhook_verify_token !== token) return res.sendStatus(403);
  res.status(200).send(challenge);
});

// Meta verification handshake - legacy (env var)
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.whatsapp.webhookVerifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming Meta (official Cloud API) messages. Both routes go through the shared
// WhatsApp pipeline, like Twilio below: saved in the common format (Inbox),
// "stop"/"start" handled, everything else to the WhatsApp agent.
async function handleMetaIncoming(req, workspaceId, conn = null) {
  const { messages, phoneNumberIds = {} } = MetaCloudProvider.handleIncomingWebhook(req);
  // A client business's own Meta number: "meta_<phone number id>", only if it's THEIR number.
  const ownId = conn?.provider_meta?.type === 'meta' ? String(conn.provider_meta.phone_number_id || '') : null;
  let sessionName = MetaCloudProvider.SESSION;
  if (ownId) {
    await MetaCloudProvider.ensureSession(workspaceId, conn);
    sessionName = MetaCloudProvider.sessionNameFor(ownId);
  }
  for (const message of messages) {
    const arrivedOn = phoneNumberIds[message.waMessageId];
    if (ownId && arrivedOn && String(arrivedOn) !== ownId) {
      console.warn(`[webhook] whatsapp (meta): message for number ${arrivedOn} arrived on another business's webhook - ignored`);
      continue;
    }
    await whatsappMessaging.handleIncomingMessage({
      providerName: 'meta',
      sessionName,
      userId: null,
      workspaceId,
      message,
    });
  }
}

// Incoming Meta messages - workspace-scoped
router.post('/whatsapp/:webhookToken', async (req, res) => {
  if (!MetaCloudProvider.verifySignature(req)) { console.warn('[webhook] whatsapp (meta): bad signature - rejected'); return res.sendStatus(403); }
  res.sendStatus(200);
  try {
    const conn = await connections.findByWebhookToken('whatsapp', req.params.webhookToken);
    if (!conn || conn.status !== 'connected') { console.warn('[webhook] whatsapp: unknown webhook token'); return; }
    await handleMetaIncoming(req, conn.workspace_id, conn);
  } catch (err) {
    console.error('[webhook] whatsapp processing failed:', err.message);
  }
});

// Incoming Meta messages - legacy (env)
router.post('/whatsapp', async (req, res) => {
  if (!MetaCloudProvider.verifySignature(req)) { console.warn('[webhook] whatsapp (meta): bad signature - rejected'); return res.sendStatus(403); }
  res.sendStatus(200);
  try {
    await handleMetaIncoming(req, await legacyWorkspaceId());
  } catch (err) {
    console.error('[webhook] whatsapp processing failed:', err.message);
  }
});

// Twilio incoming. Both routes go through the shared WhatsApp pipeline
// (core/whatsapp/messaging.js): the message is saved to whatsapp_chat_messages
// in the same shape as WAHA messages (so it shows in the Inbox), "stop"
// replies are recorded, and everything else goes to the WhatsApp agent.
async function handleTwilioIncoming(req, workspaceId) {
  const event = TwilioProvider.handleIncomingWebhook(req);
  if (event.type !== 'message') return;
  await whatsappMessaging.handleIncomingMessage({
    providerName: 'twilio',
    sessionName: TwilioProvider.SESSION,
    userId: null,
    workspaceId,
    message: event.message,
  });
}

// Twilio incoming - workspace-scoped
router.post('/whatsapp/twilio/:webhookToken', express.urlencoded({ extended: false }), async (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  try {
    const workspaceId = await resolveWorkspaceFromWebhookToken('whatsapp', req.params.webhookToken);
    if (!workspaceId) { console.warn('[webhook] whatsapp/twilio: unknown webhook token'); return; }
    await handleTwilioIncoming(req, workspaceId);
  } catch (err) {
    console.error('[webhook] whatsapp (twilio) processing failed:', err.message);
  }
});

// Twilio incoming - legacy (env)
router.post('/whatsapp/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  try {
    await handleTwilioIncoming(req, await legacyWorkspaceId());
  } catch (err) {
    console.error('[webhook] whatsapp (twilio) processing failed:', err.message);
  }
});

// ===================== TELEGRAM =====================

// Telegram incoming - workspace-scoped
router.post('/telegram/:webhookToken', async (req, res) => {
  res.sendStatus(200);
  try {
    const conn = await connections.findByWebhookToken('telegram', req.params.webhookToken);
    if (!conn || conn.status !== 'connected') {
      console.warn('[webhook] telegram: unknown webhook token');
      return;
    }

    if (conn.provider_meta?.webhook_secret) {
      const received = req.headers['x-telegram-bot-api-secret-token'];
      if (received !== conn.provider_meta.webhook_secret) {
        console.warn('[webhook] telegram request rejected - secret mismatch');
        return;
      }
    }

    const message = req.body?.message;
    if (!message || !message.text) return;
    const messageId = String(message.message_id);
    const chatId = String(message.chat?.id);
    if (!chatId) return;

    const { isNew } = await memory.recordIncomingTelegramMessage(messageId, chatId, message.text);
    if (!isNew) return;

    const agent = getAgent('telegram');
    await agent.handleIncomingMessage({ from: chatId, body: message.text, workspaceId: conn.workspace_id });
  } catch (err) {
    console.error('[webhook] telegram processing failed:', err.message);
  }
});

// Telegram incoming - legacy (env)
router.post('/telegram', async (req, res) => {
  res.sendStatus(200);
  try {
    if (config.telegram.webhookSecret) {
      const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (receivedSecret !== config.telegram.webhookSecret) {
        console.warn('[webhook] telegram request rejected - secret token mismatch');
        return;
      }
    }

    const message = req.body?.message;
    if (!message || !message.text) return;
    const messageId = String(message.message_id);
    const chatId = String(message.chat?.id);
    if (!chatId) return;

    const { isNew } = await memory.recordIncomingTelegramMessage(messageId, chatId, message.text);
    if (!isNew) return;

    const workspaceId = await legacyWorkspaceId();
    const agent = getAgent('telegram');
    await agent.handleIncomingMessage({ from: chatId, body: message.text, workspaceId });
  } catch (err) {
    console.error('[webhook] telegram processing failed:', err.message);
  }
});

module.exports = router;