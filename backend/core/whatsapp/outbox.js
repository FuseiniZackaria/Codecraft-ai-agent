const config = require('../../config');
const activityLog = require('../activityLog');
const store = require('./store');
const { getProvider } = require('./index');
const { normalizeNumber } = require('./phone');
const messaging = require('./messaging');

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
async function blockedReason(sessionName, contactNumber, { allowFirstContact = false } = {}) {
  if (await store.isOptedOut(sessionName, contactNumber)) return 'replied STOP';
  if (!allowFirstContact && config.whatsapp.outreachRequireConsent && !(await store.hasMessagedFirst(sessionName, contactNumber))) {
    return "hasn't messaged your WhatsApp first (outreach only goes to people who contacted you or sent START)";
  }
  return null;
}

/** Queue outreach messages for one admin's session. Returns { queued, rejected }. */
async function enqueue({ sessionName, userId, workspaceId, recipients, allowFirstContact = false }) {
  const rows = [];
  const rejected = [];
  for (const r of recipients || []) {
    const contactNumber = normalizeNumber(r.number);
    const text = String(r.text || '').trim();
    if (!contactNumber) { rejected.push({ number: r.number, reason: 'not a valid phone number' }); continue; }
    if (!text) { rejected.push({ number: r.number, reason: 'empty message' }); continue; }
    const blocked = await blockedReason(sessionName, contactNumber, { allowFirstContact });
    if (blocked) rejected.push({ number: r.number, reason: blocked });
    else rows.push({ sessionName, userId, workspaceId, contactNumber, text });
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
  const blocked = await blockedReason(item.session_name, item.contact_number, { allowFirstContact: true });
  if (blocked) {
    await store.updateOutbox(item.id, { status: 'skipped', error: blocked });
    await activityLog.record('WhatsApp', 'outreach_skipped', item.contact_number, { session: item.session_name, reason: blocked, workspaceId: item.workspace_id }).catch(() => {});
    console.log(`[whatsapp.outbox] skipped ${item.contact_number} (${blocked})`);
    return;
  }

  const sentToday = await store.countSentToday(item.session_name);
  if (sentToday >= config.whatsapp.dailyLimit) {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    nextSendAt.set(item.session_name, tomorrow.getTime());
    console.log(`[whatsapp.outbox] ${item.session_name} hit the daily limit (${config.whatsapp.dailyLimit}); resuming tomorrow`);
    return;
  }

  await store.updateOutbox(item.id, { status: 'sending' });
  try {
    await messaging.sendAndRecord({
      sessionName: item.session_name, to: item.contact_number, text: item.body,
      userId: item.user_id, workspaceId: item.workspace_id, source: 'outreach', typing: true,
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
async function healthCheck() {
  const provider = getProvider();
  if (provider.name !== 'waha' || !provider.isConfigured()) return;
  try {
    for (const s of await store.listWorkingSessions()) {
      const live = await provider.getStatus(s.session_name).catch(() => null);
      if (live && live.status !== 'WORKING') {
        await messaging.handleSessionStatus({ sessionName: s.session_name, status: live.status === 'NOT_FOUND' ? 'FAILED' : live.status });
      }
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

module.exports = { enqueue, tick, healthCheck, start, stop, _nextSendAt: nextSendAt };
