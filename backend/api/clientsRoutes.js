const express = require('express');
const config = require('../config');
const store = require('../core/whatsapp/store');
const clientSettings = require('../core/whatsapp/clientSettings');
const { sessionNameForUser, webhookUrl } = require('../core/whatsapp');
const WahaProvider = require('../core/whatsapp/WahaProvider');
const messaging = require('../core/whatsapp/messaging');
const { normalizeNumber } = require('../core/whatsapp/phone');

/**
 * /api/clients - the app owner's (APP_OWNER_EMAIL) view of every client
 * business: its WhatsApp number and status, tier, limits and today's numbers;
 * change a client's settings; link a client's WhatsApp for them (QR or
 * pairing code on your screen); add opted-in contacts for Meta outreach.
 * Everyone else gets 403.
 */
const router = express.Router();

function isAppOwner(req) {
  if (req.user?.role === 'owner') return true;
  const ownerEmail = (process.env.APP_OWNER_EMAIL || config.applicant?.email || '').toLowerCase();
  return !!(ownerEmail && req.user?.email?.toLowerCase() === ownerEmail);
}

router.use((req, res, next) => {
  if (!isAppOwner(req)) return res.status(403).json({ error: 'Only the app owner can manage clients.' });
  next();
});

let sb;
function db() {
  if (sb !== undefined) return sb;
  sb = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey
    ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey)
    : null;
  return sb;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All businesses: { id, name, owner_user_id, owner_email, created_at }. */
async function listWorkspaces() {
  if (!db()) {
    // No database (tests / local): the businesses that have a WhatsApp session.
    const ids = [...new Set((await store.listSessions()).map((s) => s.workspace_id).filter(Boolean))];
    return ids.map((id) => ({ id, name: id, owner_user_id: null, owner_email: null }));
  }
  const { data, error } = await db().from('workspaces').select('id, name, owner_user_id, created_at').order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const emails = new Map();
  const { data: users } = await db().auth.admin.listUsers({ perPage: 1000 }).catch(() => ({ data: null }));
  for (const u of users?.users || []) emails.set(u.id, u.email || null);
  return (data || []).map((w) => ({ ...w, owner_email: emails.get(w.owner_user_id) || null }));
}

async function getWorkspace(id) {
  if (!UUID.test(String(id))) return null;
  return (await listWorkspaces()).find((w) => w.id === id) || null;
}

/** One client's row on the Clients page. */
async function describe(ws) {
  const settings = await clientSettings.get(ws.id);
  const session = await store.getSessionForWorkspace(ws.id).catch(() => null);
  const profile = await require('../core/businessProfile').getProfile(ws.id).catch(() => null);
  let today = null;
  if (session) {
    const [replies, received, outreach] = await Promise.all([
      store.countSentBySessionToday(session.session_name, ['auto_reply']).catch(() => 0),
      store.countReceivedToday(session.session_name).catch(() => 0),
      store.countSentToday(session.session_name).catch(() => 0),
    ]);
    today = { received, replies, outreach };
  }
  return {
    id: ws.id,
    name: profile?.business_name || ws.name,
    ownerEmail: ws.owner_email,
    you: settings.operator,
    settings,
    optIns: await store.countConsent(ws.id).catch(() => 0),
    whatsapp: session ? {
      sessionName: session.session_name,
      kind: String(session.session_name).startsWith('meta_') ? 'meta' : 'waha',
      status: session.status,
      phoneNumber: session.phone_number || null,
      pushName: session.push_name || null,
      needsReconnect: !!session.needs_reconnect,
      linkedAt: session.linked_at || null,
      lastError: session.last_error || null,
    } : null,
    warmup: clientSettings.outreachLimitFor(session, settings),
    today,
  };
}

router.get('/', async (req, res) => {
  try {
    const list = await listWorkspaces();
    const clients = [];
    for (const ws of list) clients.push(await describe(ws));
    res.json({
      clients,
      server: {
        multiSession: config.waha.multiSession,
        wahaConfigured: WahaProvider.isConfigured(),
        dailyOutreachLimit: config.whatsapp.dailyLimit,
        dailyReplyLimit: config.autoReply.dailyLimitPerChannel,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/settings', async (req, res) => {
  const ws = await getWorkspace(req.params.id).catch(() => null);
  if (!ws) return res.status(404).json({ error: 'No such business.' });
  const { patch, fieldErrors, errors } = clientSettings.validate(req.body || {}, { allowed: clientSettings.OPERATOR_FIELDS });
  if (errors.length) return res.status(400).json({ error: errors[0], fieldErrors });
  try {
    await clientSettings.save(ws.id, patch, { userId: req.user.id });
    res.json(await describe(ws));
  } catch (err) {
    res.status(err.code === 'MIGRATION_MISSING' ? 503 : 500).json({ error: err.message });
  }
});

/** Opted-in contacts for Meta outreach: { numbers: "list, one per line", confirm: true }. */
router.post('/:id/consent', async (req, res) => {
  const ws = await getWorkspace(req.params.id).catch(() => null);
  if (!ws) return res.status(404).json({ error: 'No such business.' });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Tick the box to confirm these people agreed to get WhatsApp messages from this business.' });
  const raw = String(req.body?.numbers || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!raw.length) return res.status(400).json({ error: 'Paste at least one phone number.' });
  if (raw.length > 5000) return res.status(400).json({ error: 'Add at most 5000 numbers at a time.' });
  const good = [];
  const bad = [];
  for (const r of raw) {
    const n = normalizeNumber(r);
    if (n && n.length >= 9 && n.length <= 15) good.push(n); else bad.push(r);
  }
  try {
    const added = await store.addConsent(ws.id, good, { source: 'import', note: String(req.body?.note || '').slice(0, 200) || null, userId: req.user.id });
    res.json({ added, invalid: bad.slice(0, 20), invalidCount: bad.length, total: await store.countConsent(ws.id) });
  } catch (err) {
    res.status(500).json({ error: /does not exist|schema cache/i.test(err.message) ? 'Opt-ins need the 0010 migration - run it in Supabase first.' : err.message });
  }
});

// ---- Link a client's WhatsApp for them (WAHA, multi-session mode) ----

function sessionFor(ws) {
  return sessionNameForUser(ws.owner_user_id);
}

async function preflight(req, res) {
  if (!WahaProvider.isConfigured()) { res.status(400).json({ error: 'WAHA is not configured on the server (WAHA_BASE_URL).' }); return null; }
  if (!config.waha.multiSession) { res.status(400).json({ error: 'Set WAHA_MULTI_SESSION=true on the backend first, so each client gets their own number.' }); return null; }
  const ws = await getWorkspace(req.params.id).catch(() => null);
  if (!ws) { res.status(404).json({ error: 'No such business.' }); return null; }
  if (!ws.owner_user_id) { res.status(400).json({ error: 'This business has no owner account yet.' }); return null; }
  return ws;
}

router.get('/:id/whatsapp', async (req, res) => {
  const ws = await preflight(req, res);
  if (!ws) return;
  const sessionName = sessionFor(ws);
  try {
    const row = await store.getSessionByName(sessionName);
    if (!row) return res.json({ status: 'NOT_STARTED' });
    const live = await WahaProvider.getStatus(sessionName);
    if (live.status !== row.status && live.status !== 'NOT_FOUND') await messaging.handleSessionStatus({ sessionName, ...live });
    const qr = live.status === 'SCAN_QR_CODE' ? await WahaProvider.getQR(sessionName).catch(() => null) : null;
    res.json({ status: live.status, phoneNumber: live.phoneNumber || row.phone_number || null, pushName: live.pushName || null, qr });
  } catch (err) {
    res.json({ status: 'UNREACHABLE', error: err.message });
  }
});

router.post('/:id/whatsapp/start', async (req, res) => {
  const ws = await preflight(req, res);
  if (!ws) return;
  const sessionName = sessionFor(ws);
  try {
    const settings = await clientSettings.get(ws.id);
    if (settings.channel === 'meta') return res.status(409).json({ error: "This business is set to Meta's official API - change its channel to WAHA first." });
    const other = await store.getSessionForWorkspace(ws.id);
    if (other && other.session_name !== sessionName && other.status === 'WORKING') {
      return res.status(409).json({ error: `This business already has a number linked (${other.phone_number ? `+${other.phone_number}` : other.session_name}). Disconnect it first.` });
    }
    await clientSettings.ensureRow(ws.id, { userId: req.user.id });
    const status = await WahaProvider.startSession(sessionName, {
      webhookUrl: webhookUrl(),
      metadata: { 'user.id': ws.owner_user_id, 'workspace.id': ws.id, 'linked.by': req.user.email || '' },
    });
    await store.upsertSession({
      session_name: sessionName,
      user_id: ws.owner_user_id, // the client's own owner: they see their chats in their Inbox
      workspace_id: ws.id,
      status: status.status,
      phone_number: status.phoneNumber,
      push_name: status.pushName,
      needs_reconnect: false,
      disconnected_by_user: false,
      last_error: null,
    });
    res.json(status);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/:id/whatsapp/pairing-code', async (req, res) => {
  const ws = await preflight(req, res);
  if (!ws) return;
  const phoneNumber = normalizeNumber(req.body?.phoneNumber);
  if (!phoneNumber || phoneNumber.length < 9) return res.status(400).json({ error: "Enter the client's WhatsApp number with the country code, e.g. 233201234567." });
  const sessionName = sessionFor(ws);
  try {
    const live = await WahaProvider.getStatus(sessionName);
    if (live.status !== 'SCAN_QR_CODE') return res.status(409).json({ error: live.status === 'WORKING' ? 'WhatsApp is already linked.' : 'Click "Show QR code" first and wait for it to appear.' });
    res.json({ code: await WahaProvider.requestPairingCode(sessionName, phoneNumber) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/:id/whatsapp/disconnect', async (req, res) => {
  const ws = await preflight(req, res);
  if (!ws) return;
  const sessionName = sessionFor(ws);
  try {
    await store.updateSession(sessionName, { disconnected_by_user: true }).catch(() => {});
    await WahaProvider.disconnect(sessionName);
    await store.updateSession(sessionName, { status: 'STOPPED', needs_reconnect: false, phone_number: null, last_error: null });
    res.json({ disconnected: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
module.exports._isAppOwner = isAppOwner;
