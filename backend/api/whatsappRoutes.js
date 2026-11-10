const express = require('express');
const config = require('../config');
const store = require('../core/whatsapp/store');
const { getProvider, isSharedNumberProvider, sessionNameForUser, webhookUrl, canConnectWhatsapp } = require('../core/whatsapp');
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

/** This business's own Meta number session (meta_<id>), or null when it uses WAHA. */
async function metaSessionOf(req) {
  const row = await store.getSessionForWorkspace(req.user.workspaceId).catch(() => null);
  return row && String(row.session_name).startsWith('meta_') && !row.disconnected_by_user ? row : null;
}

/** The number this admin sends from: the business's Meta number, else their own WAHA session. */
async function sendingSessionFor(req) {
  const meta = await metaSessionOf(req);
  return meta ? meta.session_name : sessionNameFor(req);
}

/**
 * One WhatsApp number per business (multi-session mode): another admin of the
 * same business already linked one (or it runs on Meta). Returns a message, or null.
 */
async function businessHasOtherNumber(req, sessionName) {
  if (!req.user.workspaceId) return null;
  const row = await store.getSessionForWorkspace(req.user.workspaceId).catch(() => null);
  if (!row || row.session_name === sessionName || row.disconnected_by_user) return null;
  if (String(row.session_name).startsWith('meta_')) {
    return row.status === 'WORKING' ? "Your business uses Meta's official WhatsApp API. Disconnect it on Toolbox -> Connections before linking a phone." : null;
  }
  // Single-number mode has its own rule (heldByOther): one shared "default" session.
  if (!config.waha.multiSession) return null;
  const recent = Date.now() - new Date(row.updated_at || 0).getTime() < SCAN_WINDOW_MS;
  if (row.status === 'WORKING' || (['STARTING', 'SCAN_QR_CODE'].includes(row.status) && recent)) {
    return 'Your business already has a WhatsApp number linked by another admin. Each business links one number - ask them to disconnect it first.';
  }
  return null;
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

const NOT_AVAILABLE_MESSAGE =
  "Connecting WhatsApp isn't available for your workspace yet - right now only one WhatsApp number can be linked to CodeCraft. "
  + "We'll let you know as soon as you can connect your own.";

// Single-session WAHA: only one person can link WhatsApp (see core/whatsapp canConnectWhatsapp).
const canConnect = (req) => canConnectWhatsapp(req.user);

function fail(res, err, status = 502) {
  console.warn(`[whatsapp] ${err.message}`);
  res.status(err.status === 401 ? 502 : status).json({ error: err.message });
}

/** Session status for the Connections card and the Reconnect banner (includes the QR while waiting for a scan). */
router.get('/session', async (req, res) => {
  const clientSettings = require('../core/whatsapp/clientSettings');
  const settings = await clientSettings.get(req.user.workspaceId || null);
  const tierInfo = { tier: settings.tier, channel: settings.channel };

  // A business on Meta's official API: its own number's status, no QR code.
  const meta = await metaSessionOf(req);
  if (meta) {
    const MetaCloudProvider = require('../core/whatsapp/MetaCloudProvider');
    const live = await MetaCloudProvider.getStatus(meta.session_name);
    return res.json({
      provider: 'meta', configured: true, ...tierInfo, status: live.status, error: live.error || null,
      phoneNumber: live.phoneNumber || meta.phone_number || null, pushName: live.pushName || meta.push_name || null,
      templates: settings.meta_templates.map((t) => ({ name: t.name, language: t.language, params: t.params, body: t.body })),
    });
  }

  const provider = getProvider();
  const sessionName = sessionNameFor(req);
  const base = { provider: provider.name, configured: provider.isConfigured(), dailyLimit: config.whatsapp.dailyLimit, ...tierInfo };
  if (!provider.isConfigured()) return res.json({ ...base, status: 'NOT_CONFIGURED' });

  try {
    if (settings.channel === 'meta' && provider.name === 'waha') {
      return res.json({ ...base, status: 'USE_META', message: "Your business is set up for Meta's official WhatsApp API. Connect it in the WhatsApp (Meta / Twilio) box below with your Meta phone number ID and access token." });
    }
    const other = provider.name === 'waha' ? await businessHasOtherNumber(req, sessionName) : null;
    if (other) return res.json({ ...base, status: 'IN_USE', inUse: true, message: other });
    if (!(await canConnect(req))) {
      return res.json({ ...base, status: 'NOT_AVAILABLE', notAvailable: true, message: NOT_AVAILABLE_MESSAGE });
    }
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
    if (!(await canConnect(req))) return res.status(403).json({ error: NOT_AVAILABLE_MESSAGE, notAvailable: true });
    if (await heldByOther(req, provider, sessionName)) return res.status(409).json({ error: IN_USE_MESSAGE });
    const clientSettings = require('../core/whatsapp/clientSettings');
    if ((await clientSettings.get(req.user.workspaceId || null)).channel === 'meta') {
      return res.status(409).json({ error: "Your business is set up for Meta's official WhatsApp API - connect it with your Meta details instead of a QR code." });
    }
    const other = await businessHasOtherNumber(req, sessionName);
    if (other) return res.status(409).json({ error: other });
    // First link: fix this business's tier (clients start reply-only).
    await clientSettings.ensureRow(req.user.workspaceId || null, { userId: req.user.id });
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

/**
 * Link with a code instead of the QR: { phoneNumber } -> { code } to type in
 * WhatsApp (Linked devices -> Link a device -> Link with phone number instead).
 * Only while the caller's own session is waiting for a scan.
 */
router.post('/session/pairing-code', async (req, res) => {
  const provider = getProvider();
  if (provider.name !== 'waha' || typeof provider.requestPairingCode !== 'function') {
    return res.status(400).json({ error: 'Pairing codes need the WAHA WhatsApp connection.' });
  }
  const phoneNumber = normalizeNumber(req.body?.phoneNumber);
  if (!phoneNumber || phoneNumber.length < 9) {
    return res.status(400).json({ error: 'Enter your WhatsApp number with the country code, e.g. 233201234567.' });
  }
  const sessionName = sessionNameFor(req);
  try {
    if (!(await canConnect(req))) return res.status(403).json({ error: NOT_AVAILABLE_MESSAGE, notAvailable: true });
    const row = await store.getSessionByName(sessionName);
    if (!row || row.user_id !== req.user.id) return res.status(409).json({ error: 'Click "Connect WhatsApp" first.' });
    const live = await provider.getStatus(sessionName);
    if (live.status !== 'SCAN_QR_CODE') {
      return res.status(409).json({ error: live.status === 'WORKING' ? 'WhatsApp is already linked.' : 'WhatsApp is still getting ready - wait a few seconds and try again.' });
    }
    res.json({ code: await provider.requestPairingCode(sessionName, phoneNumber) });
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
    const sessionName = await sendingSessionFor(req);
    const shared = isSharedNumberProvider() || sessionName.startsWith('meta_');
    await messaging.sendAndRecord({
      sessionName, to: number, text,
      userId: shared ? null : req.user.id,
      workspaceId: req.user.workspaceId || null, source: 'manual',
    });
    res.json({ sent: true });
  } catch (err) {
    fail(res, err, err.code && /REPLY_ONLY|META_TEMPLATE_REQUIRED|WRONG_BUSINESS|OPTED_OUT/.test(err.code) ? 400 : 502);
  }
});

/** This business's own WhatsApp settings (alert number, town, language, auto-reply). Tier and limits are shown, not changed. */
router.get('/settings', async (req, res) => {
  if (!req.user.workspaceId) return res.status(400).json({ error: 'No workspace.' });
  const clientSettings = require('../core/whatsapp/clientSettings');
  const s = await clientSettings.get(req.user.workspaceId);
  const session = await store.getSessionForWorkspace(req.user.workspaceId).catch(() => null);
  res.json({ ...s, warmup: clientSettings.outreachLimitFor(session, s), languages: clientSettings.LANGUAGES });
});

router.put('/settings', async (req, res) => {
  if (!req.user.workspaceId) return res.status(400).json({ error: 'No workspace.' });
  if (!['owner', 'editor'].includes(req.user.workspaceRole)) return res.status(403).json({ error: "Only the business's owner or an editor can change these settings." });
  const clientSettings = require('../core/whatsapp/clientSettings');
  const { patch, fieldErrors, errors } = clientSettings.validate(req.body || {}, { allowed: clientSettings.CLIENT_FIELDS });
  if (errors.length) return res.status(400).json({ error: errors[0], fieldErrors });
  try {
    res.json(await clientSettings.save(req.user.workspaceId, patch, { userId: req.user.id }));
  } catch (err) {
    res.status(err.code === 'MIGRATION_MISSING' ? 503 : 500).json({ error: err.message });
  }
});

/**
 * Outreach: queue messages on the caller's session.
 * Body: { recipients: [{ number, text }] }  or  { numbers: [...], text }
 */
router.post('/outreach', async (req, res) => {
  const meta = await metaSessionOf(req);
  if (!meta && getProvider().name !== 'waha') return res.status(400).json({ error: 'The outreach queue needs WHATSAPP_PROVIDER=waha or a Meta number.' });
  const { recipients, numbers, text, template } = req.body || {};
  const list = Array.isArray(recipients) ? recipients : (Array.isArray(numbers) ? numbers.map((n) => ({ number: n, text, template })) : []);
  if (!list.length) return res.status(400).json({ error: 'Add at least one recipient.' });
  try {
    const session = meta || await store.getSessionByUser(req.user.id);
    if (!session) {
      const other = await heldByOther(req, getProvider(), sessionNameFor(req));
      return res.status(400).json({ error: other ? IN_USE_MESSAGE : 'Connect WhatsApp first.' });
    }
    // Templates: only ones this business registered (Settings -> Clients), with every variable filled in.
    if (list.some((r) => r.template)) {
      const settings = await require('../core/whatsapp/clientSettings').get(req.user.workspaceId || null);
      for (const r of list.filter((x) => x.template)) {
        const known = settings.meta_templates.find((t) => t.name === r.template.name && (!r.template.language || t.language === r.template.language));
        if (!known) return res.status(400).json({ error: `"${r.template.name}" isn't one of this business's approved templates.` });
        const params = (Array.isArray(r.template.params) ? r.template.params : []).map((p) => String(p || '').trim());
        if (params.length !== known.params || params.some((p) => !p)) return res.status(400).json({ error: `Fill in all ${known.params} template variable(s).` });
        r.template = { name: known.name, language: known.language, params };
        r.text = r.text || (known.body ? known.body.replace(/\{\{(\d+)\}\}/g, (_m, i) => params[Number(i) - 1] || '') : `[template: ${known.name}]`);
      }
    }
    // You typed these yourself, so they may be the first message to someone.
    const result = await outbox.enqueue({ sessionName: session.session_name, userId: req.user.id, workspaceId: req.user.workspaceId || null, recipients: list, allowFirstContact: true });
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
