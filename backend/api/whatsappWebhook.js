const express = require('express');
const store = require('../core/whatsapp/store');
const WahaProvider = require('../core/whatsapp/WahaProvider');
const messaging = require('../core/whatsapp/messaging');

/**
 * POST /api/webhooks/whatsapp - WAHA calls this for "message" and
 * "session.status" events. Public (WAHA has no user login), so every request
 * must carry a valid X-Webhook-Hmac signature made with WAHA_WEBHOOK_SECRET.
 * Mounted in server.js BEFORE the /api auth middleware.
 *
 * Always answers fast with 200 (or 401 for a bad signature) and processes the
 * event afterwards, so WAHA never retries because we were slow.
 */
const router = express.Router();

router.post('/', (req, res) => {
  const event = WahaProvider.handleIncomingWebhook(req);
  if (event.type === 'rejected') {
    console.warn(`[webhook] whatsapp (waha) rejected: ${event.reason}`);
    return res.sendStatus(401);
  }
  res.sendStatus(200);

  setImmediate(async () => {
    try {
      if (event.type === 'status') {
        await messaging.handleSessionStatus(event);
        return;
      }
      if (event.type !== 'message') return;

      const session = await store.getSessionByName(event.sessionName);
      if (!session) {
        console.warn(`[webhook] whatsapp (waha): message for unknown session ${event.sessionName} - ignored`);
        return;
      }
      await messaging.handleIncomingMessage({
        providerName: 'waha',
        sessionName: event.sessionName,
        userId: session.user_id,
        workspaceId: session.workspace_id,
        message: event.message,
      });
    } catch (err) {
      console.error(`[webhook] whatsapp (waha) processing failed: ${err.message}`);
    }
  });
});

module.exports = router;
