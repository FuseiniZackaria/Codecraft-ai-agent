const config = require('../../config');
const activityLog = require('../activityLog');
const store = require('./store');
const { getProvider } = require('./index');
const { normalizeNumber } = require('./phone');
const messaging = require('./messaging');
const clientSettings = require('./clientSettings');

/**
 * Outreach send queue (whatsapp_outbox). Per WhatsApp session:
 *   - one message at a time, a random 30-90s gap between sends (WA_OUTREACH_*_GAP_MS)
 *   - at most DAILY_WA_LIMIT sends per day (default 50); the rest wait for tomorrow
 *   - contacts who replied "stop" are skipped
 *   - only while the session is WORKING
 * Every send, skip and failure is logged. The queue lives in the database, so a
 * restart picks up where it left off.
 */

const TICK_MS = 5000;
const HEALTH_CHECK_MS = 2 * 60 * 1000;
const nextSendAt = new Map(); // sessionName -> earliest time for its next send
let timer = null;
let healthTimer = null;
let ticking = false;

/**
 * Why this contact can't get outreach right now, or null if they can:
 * they replied STOP (always), or - for AUTOMATIC messages - they've never
 * messaged this number. allowFirstContact: a first message YOU approved or typed
 * (the Sales agent's approved outreach, Inbox -> New message) may go to someone
 * new; automatic ones (lead follow-ups) never do.
 */
async function blockedReason(sessionName, contactNumber, { allowFirstContact = false, workspaceId = null } = {}) {
  if (await store.isOptedOut(sessionName, contactNumber)) return 'replied STOP';
  const row = await store.getSessionByName(sessionName).catch(() => null);
  const ws = workspaceId || row?.workspace_id || null;
  const settings = await clientSettings.get(ws);
  const messagedFirst = () => store.hasMessagedFirst(sessionName, contactNumber);

  // Meta (Tier 2): only people who messaged this number or agreed to get messages - approving it isn't consent.
  if (String(sessionName).startsWith('meta_')) {
    if (await messagedFirst() || (await store.hasConsent(ws, contactNumber))) return null;
    return "hasn't opted in (Meta outreach only goes to people who messaged this number or agreed to get messages - add them under Settings -> Clients -> Opt-ins)";
  }
  // Reply-only (Tier 1): never a first message, whoever approved it.
  if (settings.tier === 'reply_only') {
    return (await messagedFirst()) ? null : "this number is reply-only: it only messages people who messaged it first";
  }
  if (!allowFirstContact && config.whatsapp.outreachRequireConsent && !(await messagedFirst())) {
    return "hasn't messaged your WhatsApp first (outreach only goes to people who contacted you or sent START)";
  }
  return null;
}

// ---- Copy-paste messages: WhatsApp flags numbers that send the same text to many people. ----
const SIMILAR = 0.85; // word overlap that counts as "the same message"
const MAX_SIMILAR_PER_DAY = 3; // near-identical messages allowed from one number in 24 hours

const wordSet = (text) => new Set(String(text || '').toLowerCase().replace(/[0-9]+/g, ' ').split(/[^a-zÀ-ɏ']+/).filter((w) => w.length >= 2));
function similarity(a, b) {
  const A = wordSet(a);
  const B = wordSet(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both += 1;
  return both / (A.size + B.size - both);
}

/** Queue outreach messages for one admin's session. Returns { queued, rejected }. */
async function enqueue({ sessionName, userId, workspaceId, recipients, allowFirstContact = false }) {
  const rows = [];
  const rejected = [];
  const recent = await store.listRecentOutboxBodies(sessionName, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).catch(() => []);
  for (const r of recipients || []) {
    const contactNumber = normalizeNumber(r.number);
    const template = r.template && r.template.name ? { name: r.template.name, language: r.template.language || 'en', params: r.template.params || [] } : null;
    const text = String(r.text || (template ? `[template: ${template.name}]` : '')).trim();
    if (!contactNumber) { rejected.push({ number: r.number, reason: 'not a valid phone number' }); continue; }
    if (!text) { rejected.push({ number: r.number, reason: 'empty message' }); continue; }
    if (template && !String(sessionName).startsWith('meta_')) { rejected.push({ number: r.number, reason: 'templates are only for Meta WhatsApp numbers' }); continue; }
    const blocked = await blockedReason(sessionName, contactNumber, { allowFirstContact, workspaceId });
    if (blocked) { rejected.push({ number: r.number, reason: blocked }); continue; }
    // Meta-approved templates are the same by design; free text must vary.
    if (!template) {
      const same = recent.filter((b) => similarity(b, text) >= SIMILAR).length;
      if (same >= MAX_SIMILAR_PER_DAY) {
        rejected.push({ number: r.number, reason: `almost the same as ${same} other messages from this number today - change the wording for each person (WhatsApp bans numbers that send copy-paste messages)` });
        continue;
      }
      recent.push(text);
    }
    rows.push({ sessionName, userId, workspaceId, contactNumber, text, template });
  }
  if (rejected.length) console.log(`[whatsapp.outbox] not queued on ${sessionName}: ${rejected.map((x) => `${x.number} (${x.reason})`).join(', ')}`);
  await store.enqueueOutreach(rows);
  if (rows.length) console.log(`[whatsapp.outbox] queued ${rows.length} message(s) on ${sessionName}`);
  return { queued: rows.length, rejected };
}

async function processItem(item) {
  const session = await store.getSessionByName(item.session_name);
  if (!session || session.status !== 'WORKING') return; // wait until it's linked again

  // Checked again at send time: they may have replied STOP after this was queued.
  // (Who may be messaged first was decided when it was queued.)
  const blocked = await blockedReason(item.session_name, item.contact_number, { allowFirstContact: true, workspaceId: item.workspace_id });
  if (blocked) {
    await store.updateOutbox(item.id, { status: 'skipped', error: blocked });
    await activityLog.record('WhatsApp', 'outreach_skipped', item.contact_number, { session: item.session_name, reason: blocked, workspaceId: item.workspace_id }).catch(() => {});
    console.log(`[whatsapp.outbox] skipped ${item.contact_number} (${blocked})`);
    return;
  }

  // Daily limit for THIS number - lower while a newly linked number warms up.
  const settings = await clientSettings.get(item.workspace_id || session.workspace_id || null);
  const { limit, warmingUp, day, of } = clientSettings.outreachLimitFor(session, settings);
  const sentToday = await store.countSentToday(item.session_name);
  if (sentToday >= limit) {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    nextSendAt.set(item.session_name, tomorrow.getTime());
    console.log(`[whatsapp.outbox] ${item.session_name} hit the daily limit (${limit}${warmingUp ? `, warm-up day ${day} of ${of}` : ''}); resuming tomorrow`);
    return;
  }

  await store.updateOutbox(item.id, { status: 'sending' });
  try {
    await messaging.sendAndRecord({
      sessionName: item.session_name, to: item.contact_number, text: item.body,
      userId: item.user_id, workspaceId: item.workspace_id, source: 'outreach', typing: true,
      template: item.template || null,
    });
    await store.updateOutbox(item.id, { status: 'sent', sent_at: new Date().toISOString(), error: null });
  } catch (err) {
    await store.updateOutbox(item.id, { status: 'failed', error: err.message.slice(0, 500) });
  } finally {
    const gap = messaging.randomBetween(config.whatsapp.outreachMinGapMs, config.whatsapp.outreachMaxGapMs);
    nextSendAt.set(item.session_name, Date.now() + gap);
  }
}

/** One pass: at most one send per session whose gap has passed. */
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = (await store.nextQueuedPerSession()).filter((item) => (nextSendAt.get(item.session_name) || 0) <= Date.now());
    for (const item of due) {
      await processItem(item).catch((err) => console.error(`[whatsapp.outbox] item ${item.id} failed: ${err.message}`));
    }
  } catch (err) {
    console.error(`[whatsapp.outbox] tick failed: ${err.message}`);
  } finally {
    ticking = false;
  }
}

/** Ask WAHA for each linked session's real status, in case a disconnect webhook was missed. */
const serverDown = { failures: 0, alerted: false };
const SERVER_DOWN_AFTER = 3; // failed checks in a row (about 6 minutes) before you're alerted

async function healthCheck() {
  const provider = getProvider();
  if (provider.name !== 'waha' || !provider.isConfigured()) return;
  try {
    const sessions = (await store.listWorkingSessions()).filter((s) => !String(s.session_name).startsWith('meta_'));
    let reached = 0;
    let unreachable = 0;
    for (const s of sessions) {
      let live = null;
      try { live = await provider.getStatus(s.session_name); reached += 1; } catch { unreachable += 1; }
      if (live && live.status !== 'WORKING') {
        await messaging.handleSessionStatus({ sessionName: s.session_name, status: live.status === 'NOT_FOUND' ? 'FAILED' : live.status });
      }
    }
    // The WAHA server itself not answering takes EVERY client offline at once: tell the app owner.
    if (sessions.length && !reached && unreachable) {
      serverDown.failures += 1;
      if (serverDown.failures >= SERVER_DOWN_AFTER && !serverDown.alerted) {
        serverDown.alerted = true;
        await require('../notifications').notifyOperator({
          subject: 'WhatsApp server (WAHA) is not responding',
          text: `The WhatsApp server (WAHA) hasn't answered for about ${SERVER_DOWN_AFTER * 2} minutes, so ${sessions.length} linked number(s) can't send or receive. `
            + 'Check the WAHA service on Render (Logs / Metrics - is it out of memory?) and restart it if needed.',
        }).catch((err) => console.warn(`[whatsapp] WAHA-down alert failed: ${err.message}`));
      }
    } else if (reached) {
      if (serverDown.alerted) {
        await require('../notifications').notifyOperator({ subject: 'WhatsApp server is back', text: 'The WhatsApp server (WAHA) is answering again.' }).catch(() => {});
      }
      serverDown.failures = 0;
      serverDown.alerted = false;
    }
  } catch (err) {
    console.error(`[whatsapp] health check failed: ${err.message}`);
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  healthTimer = setInterval(healthCheck, HEALTH_CHECK_MS);
  timer.unref?.();
  healthTimer.unref?.();
  console.log(`[whatsapp] provider ${config.whatsapp.provider}; outreach queue started (daily limit ${config.whatsapp.dailyLimit}/session)`);
  const secret = config.waha.webhookSecret;
  if (config.whatsapp.provider === 'waha' && !secret) {
    console.warn('[whatsapp] WAHA_WEBHOOK_SECRET is not set - incoming WhatsApp messages will be rejected');
  } else if (secret && secret !== secret.trim()) {
    console.warn('[whatsapp] WAHA_WEBHOOK_SECRET starts or ends with a space - WAHA must use exactly the same value (including the space), or remove it in both places');
  }
}

function stop() {
  clearInterval(timer);
  clearInterval(healthTimer);
  timer = null;
  healthTimer = null;
}

module.exports = { enqueue, tick, healthCheck, start, stop, blockedReason, similarity, _nextSendAt: nextSendAt, _serverDown: serverDown };
