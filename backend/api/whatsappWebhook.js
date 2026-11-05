const express = require('express');
const activityLog = require('../core/activityLog');
const store = require('../core/whatsapp/store');
const WahaProvider = require('../core/whatsapp/WahaProvider');
const messaging = require('../core/whatsapp/messaging');

/**
 * POST /api/webhooks/whatsapp - WAHA calls this for "message" and
 * "session.status" events. Public (WAHA has no user login), so every request
 * must carry a valid X-Webhook-Hmac signature made with WAHA_WEBHOOK_SECRET.
 * Mounted in server.js BEFORE the /api auth middleware.
 *
 * Built for a backend that sleeps (Render free plan):
 *   - answers 200 at once and does the work afterwards, so WAHA isn't kept waiting;
 *   - WAHA retries while the backend wakes up, so the same message can arrive
 *     more than once - repeats are dropped here (recent ids in memory) and again
 *     by the database (unique message id), so a message is handled only once;
 *   - every rejected or failed webhook is logged to the console and the activity log.
 */
const router = express.Router();

const RECENT_LIMIT = 500;
const recentIds = new Set(); // message ids handled recently by this process

function seenRecently(id) {
  if (!id) return false;
  if (recentIds.has(id)) return true;
  recentIds.add(id);
  if (recentIds.size > RECENT_LIMIT) recentIds.delete(recentIds.values().next().value);
  return false;
}

function logFailure(reason, details = {}) {
  console.error(`[webhook] whatsapp (waha) failed: ${reason}`);
  activityLog.record('WhatsApp', 'webhook_failed', details.sessionName || 'waha', { reason, ...details }).catch(() => {});
}

// Temporary: one diagnostic line per delivery while webhooks are being set up.
// Turn off with WAHA_WEBHOOK_DEBUG=false. Never includes the secret or the signature.
const DEBUG = process.env.WAHA_WEBHOOK_DEBUG !== 'false';

router.post('/', (req, res) => {
  // server.js mounts this route with express.raw(), so req.body is the exact
  // bytes WAHA signed. Keep them for the HMAC check, then parse the JSON.
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    try {
      req.body = req.rawBody.length ? JSON.parse(req.rawBody.toString('utf8')) : {};
    } catch (err) {
      logFailure(`body is not valid JSON (${req.headers['content-type'] || 'no content-type'}): ${err.message}`);
      return res.sendStatus(400);
    }
  }
  if (DEBUG) console.log(`[webhook] whatsapp (waha) signature check: ${JSON.stringify(WahaProvider.inspectSignature(req))}`);

  let event;
  try {
    event = WahaProvider.handleIncomingWebhook(req);
  } catch (err) {
    logFailure(`unreadable webhook: ${err.message}`);
    return res.sendStatus(400);
  }
  if (event.type === 'rejected') {
    const why = WahaProvider.inspectSignature(req);
    const hint = why.source.includes('OLD secret')
      ? ' - this delivery comes from a session webhook registered with an older secret; open Toolbox -> Connections to repair it'
      : !why.hmacHeaderPresent && why.source.startsWith('env webhook')
        ? ' - this delivery has no signature at all: either an old delivery WAHA is still retrying from before the webhook was repaired (stops on its own), or a WHATSAPP_HOOK_URL env webhook on the WAHA service (remove it - the app registers its own signed webhook)'
        : '';
    console.warn(`[webhook] whatsapp (waha) rejected: ${event.reason}${hint}`);
    activityLog.record('WhatsApp', 'webhook_rejected', 'waha', { reason: event.reason }).catch(() => {});
    return res.sendStatus(401);
  }
  if (event.type === 'ignored') {
    // Logged so a webhook that arrives but is deliberately skipped (groups, channels,
    // your own messages) is visible in the logs instead of vanishing.
    console.log(`[webhook] whatsapp (waha) ignored: ${event.reason}`);
    return res.sendStatus(200);
  }
  if (event.type === 'message' && seenRecently(event.message.waMessageId)) {
    console.log(`[webhook] whatsapp (waha): repeat delivery of ${event.message.waMessageId} ignored`);
    return res.sendStatus(200);
  }
  if (event.type === 'message') {
    console.log(`[webhook] whatsapp (waha) message ${event.message.waMessageId} on ${event.sessionName}`);
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
        logFailure(`message for unknown session ${event.sessionName} - click Connect WhatsApp again so CodeCraft knows this session`, { sessionName: event.sessionName });
        return;
      }
      // Sender given as a private linked id (@lid): look up their phone number.
      if (!event.message.contactNumber && event.message.lid) {
        event.message.contactNumber = await WahaProvider.resolveLid(event.sessionName, event.message.lid).catch((err) => {
          console.warn(`[webhook] whatsapp (waha) lid lookup failed: ${err.message}`);
          return null;
        });
        if (!event.message.contactNumber) {
          logFailure(`couldn't find the phone number behind ${event.message.lid} - WhatsApp didn't share it`, { sessionName: event.sessionName });
          return;
        }
      }
      const result = await messaging.handleIncomingMessage({
        providerName: 'waha',
        sessionName: event.sessionName,
        userId: session.user_id,
        workspaceId: session.workspace_id,
        message: event.message,
      });
      if (result.error) {
        logFailure(`message ${event.message.waMessageId} from ${event.message.contactNumber}: ${result.error}`, { sessionName: event.sessionName });
      }
    } catch (err) {
      logFailure(err.message, { sessionName: event.sessionName });
    }
  });
});

/** Test hook. */
router._recentIds = recentIds;

module.exports = router;
