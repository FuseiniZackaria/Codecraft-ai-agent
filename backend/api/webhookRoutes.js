const express = require('express');
const config = require('../config');
const memory = require('../memory');
const { getAgent } = require('../agents/registry');
const connections = require('../core/workspaceConnections');

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

// Incoming Meta messages - workspace-scoped
router.post('/whatsapp/:webhookToken', async (req, res) => {
  res.sendStatus(200);
  try {
    const workspaceId = await resolveWorkspaceFromWebhookToken('whatsapp', req.params.webhookToken);
    if (!workspaceId) { console.warn('[webhook] whatsapp: unknown webhook token'); return; }

    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          if (msg.type !== 'text') continue;
          const { isNew } = await memory.recordIncomingMessage(msg.id, msg.from, msg.text?.body || '');
          if (!isNew) continue;
          const agent = getAgent('whatsapp');
          await agent.handleIncomingMessage({ from: msg.from, body: msg.text?.body || '', workspaceId });
        }
      }
    }
  } catch (err) {
    console.error('[webhook] whatsapp processing failed:', err.message);
  }
});

// Incoming Meta messages - legacy (env)
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200);
  try {
    const workspaceId = await legacyWorkspaceId();
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          if (msg.type !== 'text') continue;
          const { isNew } = await memory.recordIncomingMessage(msg.id, msg.from, msg.text?.body || '');
          if (!isNew) continue;
          const agent = getAgent('whatsapp');
          await agent.handleIncomingMessage({ from: msg.from, body: msg.text?.body || '', workspaceId });
        }
      }
    }
  } catch (err) {
    console.error('[webhook] whatsapp processing failed:', err.message);
  }
});

// Twilio incoming - workspace-scoped
router.post('/whatsapp/twilio/:webhookToken', express.urlencoded({ extended: false }), async (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  try {
    const workspaceId = await resolveWorkspaceFromWebhookToken('whatsapp', req.params.webhookToken);
    if (!workspaceId) { console.warn('[webhook] whatsapp/twilio: unknown webhook token'); return; }
    const { MessageSid, From, Body } = req.body;
    if (!MessageSid || !From) return;
    const fromNumber = From.replace(/^whatsapp:/, '');
    const { isNew } = await memory.recordIncomingMessage(MessageSid, fromNumber, Body || '');
    if (!isNew) return;
    const agent = getAgent('whatsapp');
    await agent.handleIncomingMessage({ from: fromNumber, body: Body || '', workspaceId });
  } catch (err) {
    console.error('[webhook] whatsapp (twilio) processing failed:', err.message);
  }
});

// Twilio incoming - legacy (env)
router.post('/whatsapp/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  try {
    const workspaceId = await legacyWorkspaceId();
    const { MessageSid, From, Body } = req.body;
    if (!MessageSid || !From) return;
    const fromNumber = From.replace(/^whatsapp:/, '');
    const { isNew } = await memory.recordIncomingMessage(MessageSid, fromNumber, Body || '');
    if (!isNew) return;
    const agent = getAgent('whatsapp');
    await agent.handleIncomingMessage({ from: fromNumber, body: Body || '', workspaceId });
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