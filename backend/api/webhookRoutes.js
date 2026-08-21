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

// Actual incoming Meta messages land here.
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

// Twilio's incoming messages - a totally different shape from Meta's: one
// message per POST, form-urlencoded (not JSON), and Twilio expects a valid
// (even if empty) TwiML XML response, not a plain 200. Separate route/
// middleware rather than trying to sniff format on a shared endpoint.
router.post('/whatsapp/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  // Empty TwiML = "received, no auto-reply via TwiML" - our own agent
  // handles drafting a reply asynchronously below instead.
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  try {
    const { MessageSid, From, Body } = req.body;
    if (!MessageSid || !From) return;

    const fromNumber = From.replace(/^whatsapp:/, '');
    const { isNew } = await memory.recordIncomingMessage(MessageSid, fromNumber, Body || '');
    if (!isNew) return; // dedupe Twilio's retries

    const agent = getAgent('whatsapp');
    await agent.handleIncomingMessage({ from: fromNumber, body: Body || '' });
  } catch (err) {
    console.error('[webhook] whatsapp (twilio) processing failed:', err.message);
  }
});

module.exports = router;
