const express = require('express');
const config = require('../config');
const memory = require('../memory');
const { getAgent } = require('../agents/registry');

const router = express.Router();

// Meta's one-time verification handshake when you register the webhook URL.
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.webhookVerifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Actual incoming messages land here.
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200); // ack immediately - Meta retries on non-2xx or timeout

  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          if (msg.type !== 'text') continue; // skip media/status updates for now

          const { isNew } = await memory.recordIncomingMessage(msg.id, msg.from, msg.text?.body || '');
          if (!isNew) continue; // dedupe Meta's retries

          const agent = getAgent('whatsapp');
          await agent.handleIncomingMessage({ from: msg.from, body: msg.text?.body || '' });
        }
      }
    }
  } catch (err) {
    console.error('[webhook] whatsapp processing failed:', err.message);
  }
});

module.exports = router;
