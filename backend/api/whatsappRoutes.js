const express = require('express');
const config = require('../config');
const store = require('../core/whatsapp/store');
const { getProvider, sessionNameForUser, webhookUrl } = require('../core/whatsapp');
const messaging = require('../core/whatsapp/messaging');
const outbox = require('../core/whatsapp/outbox');
const { normalizeNumber } = require('../core/whatsapp/phone');

/**
 * /api/whatsapp - signed-in admins only (mounted behind requireAuth in server.js).
 * Every route works on the caller's OWN session (named from their user id), so
 * admins never see or send from each other's WhatsApp.
 */
const router = express.Router();

// Twilio has one shared account, not per-admin sessions.
function sessionNameFor(req) {
  return getProvider().name === 'twilio' ? 'twilio' : sessionNameForUser(req.user.id);
}

function viewer(req) {
  return { userId: req.user.id, workspaceId: req.user.workspaceId || null };
}

function fail(res, err, status = 502) {
  console.warn(`[whatsapp] ${err.message}`);
  res.status(err.status === 401 ? 502 : status).json({ error: err.message });
}

/** Session status for the Connections card and the Reconnect banner (includes the QR while waiting for a scan). */
router.get('/session', async (req, res) => {
  const provider = getProvider();
  const sessionName = sessionNameFor(req);
  const base = { provider: provider.name, configured: provider.isConfigured(), dailyLimit: config.whatsapp.dailyLimit };
  if (!provider.isConfigured()) return res.json({ ...base, status: 'NOT_CONFIGURED' });

  try {
    const row = provider.name === 'waha' ? await store.getSessionByUser(req.user.id) : null;
    if (provider.name === 'waha' && !row) return res.json({ ...base, status: 'NOT_STARTED' });

    const live = await provider.getStatus(sessionName);
    if (row && live.status !== row.status && live.status !== 'NOT_FOUND') {
      await messaging.handleSessionStatus({ sessionName, ...live });
    }
    // The session was linked through another backend (e.g. local testing, now Render):
    // point WAHA's webhook at this one so incoming messages arrive here.
    const hook = webhookUrl();
    if (provider.name === 'waha' && hook && live.status === 'WORKING' && Array.isArray(live.webhooks) && !live.webhooks.includes(hook)) {
      console.log(`[whatsapp] updating ${sessionName} webhook to ${hook}`);
      await provider.startSession(sessionName, { webhookUrl: hook, metadata: { 'user.id': req.user.id } })
        .catch((err) => console.warn(`[whatsapp] webhook update failed: ${err.message}`));
    }
    const fresh = row ? await store.getSessionByName(sessionName) : null;
    const qr = live.status === 'SCAN_QR_CODE' ? await provider.getQR(sessionName).catch(() => null) : null;
    res.json({
      ...base,
      status: live.status === 'NOT_FOUND' && fresh?.needs_reconnect ? 'FAILED' : live.status,
      phoneNumber: live.phoneNumber || fresh?.phone_number || null,
      pushName: live.pushName || fresh?.push_name || null,
      needsReconnect: !!fresh?.needs_reconnect,
      lastError: fresh?.last_error || null,
      qr,
    });
  } catch (err) {
    // WAHA unreachable: report it instead of failing the page.
    const row = await store.getSessionByUser(req.user.id).catch(() => null);
    res.json({ ...base, status: 'UNREACHABLE', error: err.message, phoneNumber: row?.phone_number || null, needsReconnect: !!row?.needs_reconnect });
  }
});

/** Start (or restart) the caller's session. The QR then comes from GET /session. */
router.post('/session/start', async (req, res) => {
  const provider = getProvider();
  if (!provider.isConfigured()) {
    return res.status(400).json({ error: provider.name === 'waha' ? 'WAHA is not configured on the server (WAHA_BASE_URL).' : 'Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).' });
  }
  if (provider.name === 'twilio') return res.json(await provider.getStatus());

  const sessionName = sessionNameFor(req);
  const hook = webhookUrl();
  try {
    const status = await provider.startSession(sessionName, {
      webhookUrl: hook,
      metadata: { 'user.id': req.user.id, 'user.email': req.user.email || '', 'workspace.id': req.user.workspaceId || '' },
    });
    await store.upsertSession({
      session_name: sessionName,
      user_id: req.user.id,
      workspace_id: req.user.workspaceId || null,
      status: status.status,
      phone_number: status.phoneNumber,
      push_name: status.pushName,
      needs_reconnect: false,
      disconnected_by_user: false,
      last_error: null,
    });
    res.json({
      ...status,
      warning: hook ? null : 'WAHA_WEBHOOK_BASE_URL (or RENDER_EXTERNAL_URL) is not set, so incoming messages will not reach CodeCraft.',
    });
  } catch (err) {
    fail(res, err);
  }
});

/** Unlink the caller's WhatsApp. */
router.post('/session/disconnect', async (req, res) => {
  const provider = getProvider();
  const sessionName = sessionNameFor(req);
  try {
    await store.updateSession(sessionName, { disconnected_by_user: true }).catch(() => {});
    await provider.disconnect(sessionName);
    await store.updateSession(sessionName, { status: 'STOPPED', needs_reconnect: false, phone_number: null, last_error: null });
    res.json({ disconnected: true });
  } catch (err) {
    fail(res, err);
  }
});

/** Inbox: the caller's conversations, newest first. */
router.get('/conversations', async (req, res) => {
  try {
    res.json(await store.listConversations(viewer(req)));
  } catch (err) {
    fail(res, err, 500);
  }
});

router.get('/conversations/:number/messages', async (req, res) => {
  const number = normalizeNumber(req.params.number);
  if (!number) return res.status(400).json({ error: 'Invalid phone number' });
  try {
    res.json(await store.listMessages(viewer(req), number));
  } catch (err) {
    fail(res, err, 500);
  }
});

/** Manual reply from the inbox - sends right away (no typing delay). */
router.post('/conversations/:number/reply', async (req, res) => {
  const number = normalizeNumber(req.params.number);
  const text = String(req.body?.text || '').trim();
  if (!number) return res.status(400).json({ error: 'Invalid phone number' });
  if (!text) return res.status(400).json({ error: 'Message is empty' });
  try {
    await messaging.sendAndRecord({
      sessionName: sessionNameFor(req), to: number, text,
      userId: getProvider().name === 'twilio' ? null : req.user.id,
      workspaceId: req.user.workspaceId || null, source: 'manual',
    });
    res.json({ sent: true });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Outreach: queue messages on the caller's session.
 * Body: { recipients: [{ number, text }] }  or  { numbers: [...], text }
 */
router.post('/outreach', async (req, res) => {
  if (getProvider().name !== 'waha') return res.status(400).json({ error: 'The outreach queue needs WHATSAPP_PROVIDER=waha.' });
  const { recipients, numbers, text } = req.body || {};
  const list = Array.isArray(recipients) ? recipients : (Array.isArray(numbers) ? numbers.map((n) => ({ number: n, text })) : []);
  if (!list.length) return res.status(400).json({ error: 'Add at least one recipient.' });
  try {
    const session = await store.getSessionByUser(req.user.id);
    if (!session) return res.status(400).json({ error: 'Connect WhatsApp first.' });
    const result = await outbox.enqueue({ sessionName: session.session_name, userId: req.user.id, workspaceId: req.user.workspaceId || null, recipients: list });
    res.json({ ...result, dailyLimit: config.whatsapp.dailyLimit });
  } catch (err) {
    fail(res, err, 500);
  }
});

router.get('/outbox', async (req, res) => {
  try {
    res.json(await store.listOutbox(req.user.id));
  } catch (err) {
    fail(res, err, 500);
  }
});

module.exports = router;
