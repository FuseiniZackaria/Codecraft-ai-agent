const express = require('express');
const config = require('../config');
const store = require('../core/whatsapp/store');
const { getProvider, isSharedNumberProvider, sessionNameForUser, webhookUrl } = require('../core/whatsapp');
const messaging = require('../core/whatsapp/messaging');
const outbox = require('../core/whatsapp/outbox');
const { normalizeNumber } = require('../core/whatsapp/phone');
const WahaProvider = require('../core/whatsapp/WahaProvider');

/**
 * /api/whatsapp - signed-in admins only (mounted behind requireAuth in server.js).
 * Every route works on the caller's OWN session (named from their user id), so
 * admins never see or send from each other's WhatsApp.
 */
const router = express.Router();

// Twilio and Meta use one shared business number, not per-admin sessions.
function sessionNameFor(req) {
  const provider = getProvider();
  return isSharedNumberProvider(provider.name) ? provider.SESSION : sessionNameForUser(req.user.id);
}

function viewer(req) {
  return { userId: req.user.id, workspaceId: req.user.workspaceId || null };
}

const IN_USE_MESSAGE =
  'WhatsApp is already connected by another admin. Only one admin can link WhatsApp at a time on this setup - ' +
  'ask them to disconnect it first (or turn on WAHA_MULTI_SESSION so each admin gets their own).';
const SCAN_WINDOW_MS = 5 * 60 * 1000; // a QR scan in progress reserves the shared session this long

/**
 * Single-session mode only: the shared session's row when ANOTHER admin has it
 * connected (or is scanning its QR right now), else null. A shared session that
 * was disconnected can be taken over by any admin.
 */
async function heldByOther(req, provider, sessionName) {
  if (config.waha.multiSession || provider.name !== 'waha') return null;
  const row = await store.getSessionByName(sessionName);
  if (!row || row.user_id === req.user.id) return null;
  const live = await provider.getStatus(sessionName).catch(() => null);
  const status = live && live.status !== 'NOT_FOUND' ? live.status : row.status;
  if (status === 'WORKING') return row;
  const recent = Date.now() - new Date(row.updated_at || 0).getTime() < SCAN_WINDOW_MS;
  if (['STARTING', 'SCAN_QR_CODE'].includes(status) && recent) return row;
  return null;
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
    if (await heldByOther(req, provider, sessionName)) {
      return res.json({ ...base, status: 'IN_USE', inUse: true, message: IN_USE_MESSAGE });
    }
    const row = provider.name === 'waha' ? await store.getSessionByUser(req.user.id) : null;
    if (provider.name === 'waha' && !row) return res.json({ ...base, status: 'NOT_STARTED' });

    const live = await provider.getStatus(sessionName);
    if (row && live.status !== row.status && live.status !== 'NOT_FOUND') {
      await messaging.handleSessionStatus({ sessionName, ...live });
    }
    // Repair the session's own webhook if incoming messages can't reach this
    // backend: it points somewhere else, or it's signed with a key other than
    // the current WAHA_WEBHOOK_SECRET (none, or an older one) - WAHA keeps the
    // key it was given at connect time, whatever the env vars say later.
    const hook = webhookUrl();
    const wrongUrl = Array.isArray(live.webhooks) && !live.webhooks.includes(hook);
    const staleKey = provider.name === 'waha' && WahaProvider.staleWebhooks(live.rawWebhooks || [], hook).length > 0;
    if (provider.name === 'waha' && hook && live.status === 'WORKING' && (wrongUrl || staleKey)) {
      console.log(`[whatsapp] updating ${sessionName} webhook to ${hook}${staleKey ? ' (re-registering it with the current WAHA_WEBHOOK_SECRET)' : ''}`);
      await provider.startSession(sessionName, { webhookUrl: hook, metadata: { 'user.id': req.user.id } })
        .catch((err) => console.warn(`[whatsapp] webhook update failed: ${err.message}`));
      const again = await provider.getStatus(sessionName).catch(() => null);
      const fixed = !!again && again.webhooks.includes(hook) && WahaProvider.staleWebhooks(again.rawWebhooks || [], hook).length === 0;
      console.log(fixed
        ? `[whatsapp] webhook for ${sessionName} repaired - WAHA now signs with the current WAHA_WEBHOOK_SECRET`
        : `[whatsapp] webhook for ${sessionName} could NOT be repaired - check the WAHA service logs`);
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
    return res.status(400).json({ error: { waha: 'WAHA is not configured on the server (WAHA_BASE_URL).', twilio: 'Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).', meta: 'Meta WhatsApp is not configured (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).' }[provider.name] });
  }
  if (isSharedNumberProvider(provider.name)) return res.json(await provider.getStatus());

  const sessionName = sessionNameFor(req);
  const hook = webhookUrl();
  try {
    if (await heldByOther(req, provider, sessionName)) return res.status(409).json({ error: IN_USE_MESSAGE });
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
    const row = provider.name === 'waha' ? await store.getSessionByName(sessionName) : null;
    if (row && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the admin who connected this WhatsApp can disconnect it.' });
    }
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
      userId: isSharedNumberProvider() ? null : req.user.id,
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
    if (!session) {
      const other = await heldByOther(req, getProvider(), sessionNameFor(req));
      return res.status(400).json({ error: other ? IN_USE_MESSAGE : 'Connect WhatsApp first.' });
    }
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
