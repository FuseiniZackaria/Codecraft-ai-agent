const store = require('./store');

/**
 * Leads: every person who messages on WhatsApp becomes a lead; Ian fills in
 * what he learns (name, business, need, budget, timeline, location, a short
 * summary) as part of his normal reply - no extra AI call; hot leads alert the
 * owner; quiet leads get up to 2 friendly follow-ups; a daily summary.
 *
 * Follow-up safety (all must hold):
 *   - only people who messaged first (WhatsApp leads; scraped leads NEVER) -
 *     and the send queue checks that again;
 *   - never after STOP, "not interested", Won or Lost, or while a reply is
 *     waiting for the owner (a pending approval task);
 *   - at most 2 per lead, ever; only 8am-7pm Ghana time, never on Sundays;
 *   - sent through the paced outreach queue (gaps, daily cap) - or, with
 *     "ask me before sending follow-ups" (on by default), as approval tasks.
 */

const STATUSES = ['new', 'interested', 'quote_sent', 'won', 'lost', 'not_interested'];
const NEEDS = ['website', 'ecommerce', 'design', 'ai_assistant', 'seo', 'other'];
const NO_FOLLOWUP = new Set(['won', 'lost', 'not_interested']);
const MAX_FOLLOWUPS = 2;
const DAY = 24 * 60 * 60 * 1000;
const PER_TICK = 10;
const HOT_GAP_MS = DAY;

// ---------- time (the business's time zone, default Ghana) ----------
function localNow(date = new Date()) {
  const tz = process.env.WA_TIMEZONE || 'Africa/Accra';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  }
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return {
    hour, minute,
    sunday: get('weekday') === 'Sun',
    date: `${get('year')}-${get('month')}-${get('day')}`,
    // Start of today, local, as a real time.
    startOfDay: new Date(date.getTime() - ((hour * 60 + minute) * 60 + date.getSeconds()) * 1000 - date.getMilliseconds()).toISOString(),
  };
}
/** Follow-ups only 8am-7pm local time, never on Sundays. */
function canFollowUpNow(date = new Date()) {
  const t = localNow(date);
  return !t.sunday && t.hour >= 8 && t.hour < 19;
}

// ---------- capture ----------

/** A message came in: create the lead (status New) or update its dates. Never throws. */
async function recordInbound({ workspaceId, sessionName, userId, contactNumber, contactName, at = new Date().toISOString() }) {
  if (!workspaceId || !contactNumber) return null;
  try {
    const lead = await store.findByNumber(workspaceId, contactNumber);
    if (!lead) {
      return await store.createLead(workspaceId, {
        source: 'whatsapp', session_name: sessionName, user_id: userId, contact_number: contactNumber,
        contact_name: contactName || null, last_message_at: at, last_inbound_at: at,
      });
    }
    return await store.updateLead(workspaceId, lead.id, {
      last_message_at: at, last_inbound_at: at, contact_name: lead.contact_name || contactName || null,
      session_name: lead.session_name || sessionName, user_id: lead.user_id || userId,
    });
  } catch (err) {
    if (err.code !== 'MIGRATION_MISSING') console.warn(`[leads] couldn't record ${contactNumber}: ${err.message}`);
    return null;
  }
}

const clean = (v, max = 120) => {
  const s = String(v ?? '').trim();
  return s && !/^(null|none|unknown|n\/a|-)$/i.test(s) ? s.slice(0, max) : null;
};

/** What the model reported about the lead (part of Ian's normal JSON answer). */
function normalizeInfo(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const need = clean(raw.need, 30)?.toLowerCase().replace(/[\s-]+/g, '_');
  const status = clean(raw.status, 30)?.toLowerCase().replace(/[\s-]+/g, '_');
  return {
    name: clean(raw.name, 80),
    business_type: clean(raw.business_type, 100),
    need: need ? (NEEDS.includes(need) ? need : (/e_?commerce|shop|store/.test(need) ? 'ecommerce' : /ai|bot|assistant/.test(need) ? 'ai_assistant' : 'other')) : null,
    budget: clean(raw.budget, 80),
    timeline: clean(raw.timeline, 80),
    location: clean(raw.location, 80),
    summary: clean(raw.summary, 400),
    status: ['interested', 'not_interested'].includes(status) ? status : null,
  };
}

/**
 * After Ian drafted a reply: merge what he learned, move the status on
 * (New -> Interested, or Not interested - never over the owner's Won/Lost or
 * an existing Quote sent), and alert the owner about a hot lead (once a day).
 */
async function applyFromAgent({ workspaceId, contactNumber, info, incoming }) {
  if (!workspaceId || !contactNumber) return null;
  try {
    const lead = await store.findByNumber(workspaceId, contactNumber);
    if (!lead) return null;
    const got = normalizeInfo(info);
    const patch = {};
    for (const k of ['name', 'business_type', 'need', 'budget', 'timeline', 'location', 'summary']) {
      if (got[k] && got[k] !== lead[k]) patch[k] = got[k];
    }
    const ownerSet = lead.status_set_by === 'owner' && ['won', 'lost', 'quote_sent', 'not_interested'].includes(lead.status);
    if (!ownerSet && !['won', 'lost'].includes(lead.status)) {
      if (got.status === 'not_interested') patch.status = 'not_interested';
      else if ((got.status === 'interested' || got.need) && lead.status === 'new') patch.status = 'interested';
    }
    const hot = require('../whatsapp/replyPolicy').hotReason(incoming);
    let alerted = false;
    if (hot && !NO_FOLLOWUP.has(patch.status || lead.status)
      && (!lead.hot_alerted_at || Date.now() - new Date(lead.hot_alerted_at).getTime() > HOT_GAP_MS)) {
      patch.hot_alerted_at = new Date().toISOString();
      if (lead.status === 'new' && !patch.status) patch.status = 'interested';
      alerted = true;
    }
    const saved = Object.keys(patch).length ? await store.updateLead(workspaceId, lead.id, patch) : lead;
    if (alerted) {
      const who = saved.name || saved.contact_name || `+${contactNumber}`;
      const text = `Hot lead on WhatsApp: ${who} (+${contactNumber}) ${hot}.\n\n`
        + `They said: "${String(incoming || '').slice(0, 200)}"\n`
        + (saved.need ? `Needs: ${needLabel(saved.need)}${saved.business_type ? ` for a ${saved.business_type}` : ''}\n` : '')
        + (saved.summary ? `Summary: ${saved.summary}\n` : '')
        + '\nSee Work -> Leads in CodeCraft.';
      require('../notifications').notifyOwner({ subject: `Hot lead: ${who}`, text, workspaceId })
        .catch((err) => console.warn(`[leads] hot-lead alert failed: ${err.message}`));
    }
    return { lead: saved, hot: alerted ? hot : null };
  } catch (err) {
    if (err.code !== 'MIGRATION_MISSING') console.warn(`[leads] couldn't update ${contactNumber}: ${err.message}`);
    return null;
  }
}

// A price in something actually sent to the customer = a quote went out (only you can send prices).
const PRICE_RE = /(gh₵|₵|\bghs|\busd|\$|€|£)\s?\d|\b\d[\d,.]*\s?(cedis?|ghs|dollars|usd)\b/i;

/** Something was sent to this contact (reply, approved answer, follow-up, your manual reply). Never throws. */
async function recordOutbound({ workspaceId, contactNumber, text, source, at = new Date().toISOString() }) {
  if (!workspaceId || !contactNumber || source === 'owner_alert') return null;
  try {
    const lead = await store.findByNumber(workspaceId, contactNumber);
    if (!lead) return null;
    const patch = { last_outbound_at: at, last_message_at: at };
    if (PRICE_RE.test(String(text || '')) && !['won', 'lost', 'not_interested'].includes(lead.status)) {
      patch.status = 'quote_sent';
      patch.status_set_by = 'ian';
    }
    return await store.updateLead(workspaceId, lead.id, patch);
  } catch (err) {
    if (err.code !== 'MIGRATION_MISSING') console.warn(`[leads] couldn't record a reply to ${contactNumber}: ${err.message}`);
    return null;
  }
}

// ---------- follow-ups ----------

const ms = (iso) => (iso ? new Date(iso).getTime() : 0);

/** Is this lead due a follow-up now (timing + status only - stop/hold/hours are checked separately)? */
function followUpDue(lead, settings, now = Date.now()) {
  if (lead.source !== 'whatsapp' || !lead.last_inbound_at) return false; // only people who messaged first
  if (NO_FOLLOWUP.has(lead.status)) return false;
  const sent = lead.followups_sent || 0;
  if (sent >= MAX_FOLLOWUPS) return false;
  const lastIn = ms(lead.last_inbound_at);
  const lastOut = ms(lead.last_outbound_at);
  if (!lastOut || lastOut < lastIn) return false; // they spoke last: it's our turn to reply, not to chase
  if (sent === 0) return now - Math.max(lastIn, lastOut) >= (settings.first_followup_days || 2) * DAY;
  // Second: counted from their last message, and at least a day after the first follow-up.
  return now - lastIn >= (settings.second_followup_days || 5) * DAY && now - ms(lead.last_followup_at) >= DAY;
}

/** Why a due lead must not get a follow-up right now, or null. */
async function blockedReason(workspaceId, lead) {
  const wa = require('../whatsapp/store');
  if (lead.session_name && (await wa.isOptedOut(lead.session_name, lead.contact_number).catch(() => false))) return 'replied STOP';
  const memory = require('../../memory');
  const pending = await memory.listTasks({ workspaceId, status: 'pending_approval', limit: 300 }).catch(() => []);
  const digits = (v) => String(v || '').replace(/\D/g, '');
  if (pending.some((t) => digits(t.payload?.to) === digits(lead.contact_number))) return 'a reply is waiting for your approval';
  return null;
}

/** Write a short, personal follow-up from the last conversation (one AI call). */
async function draftFollowUp(workspaceId, lead, now = new Date()) {
  const businessProfile = require('../businessProfile');
  const profile = await businessProfile.getProfile(workspaceId).catch(() => null);
  const v = await require('../knowledge/agentSettings').forAgent(workspaceId, profile);
  const wa = require('../whatsapp/store');
  const history = await wa.listMessages({ userId: lead.user_id, workspaceId }, lead.contact_number, 12).catch(() => []);
  const transcript = history.slice(-10).map((m) => `${m.direction === 'in' ? 'Customer' : v.agentName}: ${String(m.body || '').slice(0, 300)}`).join('\n');
  const time = require('../whatsapp/voice').ghanaTime(now);
  const second = (lead.followups_sent || 0) >= 1;
  const result = await require('../router').selectProvider({}).complete({
    maxTokens: 400,
    system: `${v.instructions}\n\nYou are writing a short follow-up WhatsApp message to someone who went quiet.\n`
      + `Rules: 1-2 sentences. Begin with "${time.greeting}". Mention what they were interested in, personally. Friendly, no pressure, `
      + 'no prices, no discounts, no promises or deadlines, at most one question, no sign-off. '
      + (second ? 'This is the LAST follow-up: make it gentle and say they can reach out any time.' : '')
      + '\nAnswer with ONLY the message text.',
    prompt: `${lead.summary ? `What we know: ${lead.summary}\n` : ''}${lead.need ? `They need: ${needLabel(lead.need)}${lead.business_type ? ` for a ${lead.business_type}` : ''}\n` : ''}`
      + `Conversation so far:\n${transcript || '(no messages saved)'}\n\nWrite the follow-up.`,
  });
  const policy = require('../whatsapp/replyPolicy');
  const text = policy.cleanReply(String(result.text || '').replace(/^["'\s]+|["'\s]+$/g, ''), { agentName: v.agentName });
  // The usual checks: a price, a promise, a made-up link... means a person must look first.
  const knowledge = await require('../businessContext').businessContextLine(workspaceId, { forChat: true }).catch(() => '');
  const check = policy.decideRouting({ incoming: '', draft: text, knowledge, agentName: v.agentName, businessName: profile?.business_name || null });
  return { text, safe: !check.hold, reason: check.reason };
}

/** Follow-up one lead: approval task (ask-first, or anything flagged) or the paced queue. */
async function followUp(workspaceId, lead, settings, now = new Date()) {
  const draft = await draftFollowUp(workspaceId, lead, now);
  if (!draft.text) return { status: 'skipped', reason: 'empty draft' };
  const count = { followups_sent: (lead.followups_sent || 0) + 1, last_followup_at: now.toISOString() };
  const label = (lead.followups_sent || 0) === 0 ? 'first' : 'second (last)';

  if (settings.ask_before_followup || !draft.safe) {
    const agent = require('../../agents/registry').getAgent('whatsapp');
    const task = await agent.createApprovalTask({
      instruction: `Follow-up (${label}) on WhatsApp to ${lead.contact_number}`,
      tool: 'whatsapp.sendMessage',
      payload: { to: lead.contact_number, body: draft.text, outreach: true },
      workspaceId,
    });
    await store.updateLead(workspaceId, lead.id, count);
    require('../notifications').notifyOwnerPendingApproval({
      channel: 'whatsapp', from: lead.contact_number, customerMessage: `(no reply for a while - ${label} follow-up)`, draftReply: draft.text,
      approvalTaskId: task.id, workspaceId,
      reason: settings.ask_before_followup ? 'follow-up - you asked to approve follow-ups first' : `follow-up needs a look: ${draft.reason}`,
    }).catch(() => {});
    return { status: 'awaiting_approval', taskId: task.id, text: draft.text };
  }

  const result = await require('../whatsapp/outbox').enqueue({
    sessionName: lead.session_name, userId: lead.user_id, workspaceId,
    recipients: [{ number: lead.contact_number, text: draft.text }],
  });
  if (!result.queued) return { status: 'skipped', reason: result.rejected[0]?.reason || 'not queued' };
  await store.updateLead(workspaceId, lead.id, count);
  return { status: 'queued', text: draft.text };
}

/** Find and handle due follow-ups for one workspace. Returns what happened. */
async function runFollowUps(workspaceId, now = new Date()) {
  const settings = await store.getSettings(workspaceId);
  if (!settings.followups_enabled) return { done: [], reason: 'follow-ups are off' };
  if (!canFollowUpNow(now)) return { done: [], reason: 'outside 8am-7pm, or Sunday' };
  const leads = (await store.listLeads(workspaceId)).filter((l) => followUpDue(l, settings, now.getTime()));
  const done = [];
  for (const lead of leads.slice(0, PER_TICK)) {
    const blocked = await blockedReason(workspaceId, lead);
    if (blocked) { done.push({ lead: lead.id, status: 'skipped', reason: blocked }); continue; }
    try {
      done.push({ lead: lead.id, ...(await followUp(workspaceId, lead, settings, now)) });
    } catch (err) {
      console.warn(`[leads] follow-up for ${lead.contact_number} failed: ${err.message}`);
      done.push({ lead: lead.id, status: 'failed', reason: err.message });
    }
  }
  return { done };
}

// ---------- daily summary ----------

async function buildSummary(workspaceId, now = new Date()) {
  const since = localNow(now).startOfDay;
  const leads = (await store.listLeads(workspaceId)).filter((l) => l.source === 'whatsapp');
  const after = (iso) => !!iso && ms(iso) >= ms(since);
  const fresh = leads.filter((l) => after(l.created_at));
  const followed = leads.filter((l) => after(l.last_followup_at));
  const replied = leads.filter((l) => after(l.last_inbound_at) && !after(l.created_at));
  const hot = leads.filter((l) => after(l.hot_alerted_at));
  const name = (l) => l.name || l.contact_name || `+${l.contact_number}`;
  const list = (arr) => arr.slice(0, 5).map((l) => `${name(l)}${l.need ? ` (${needLabel(l.need)})` : ''}`).join(', ') + (arr.length > 5 ? `, +${arr.length - 5} more` : '');
  const counts = { newLeads: fresh.length, followUps: followed.length, replies: replied.length, hot: hot.length };
  if (!fresh.length && !followed.length && !replied.length) return { counts, text: null };
  const lines = [
    'Your CodeCraft leads today',
    '',
    `New leads: ${fresh.length}${fresh.length ? ` - ${list(fresh)}` : ''}`,
    `Replies from earlier leads: ${replied.length}${replied.length ? ` - ${list(replied)}` : ''}`,
    `Follow-ups sent or waiting for you: ${followed.length}`,
    hot.length ? `Hot leads: ${list(hot)}` : null,
    '',
    'See Work -> Leads in CodeCraft.',
  ].filter((x) => x !== null);
  return { counts, text: lines.join('\n') };
}

async function runDailySummary(workspaceId, now = new Date()) {
  const settings = await store.getSettings(workspaceId);
  const t = localNow(now);
  if (!settings.daily_summary || t.hour < (settings.summary_hour ?? 19) || settings.last_summary_on === t.date) return null;
  await store.saveSettings(workspaceId, { last_summary_on: t.date }); // once a day, even if there was nothing to say
  const { text } = await buildSummary(workspaceId, now);
  if (!text) return { sent: false, reason: 'nothing happened today' };
  const results = await require('../notifications').notifyOwner({ subject: 'Your leads today', text, workspaceId });
  return { sent: true, results };
}

/** Scheduler hook (every minute; does real work every 5 minutes). */
let lastTick = 0;
let ticking = false;
async function tick(now = new Date()) {
  if (ticking || now.getTime() - lastTick < 5 * 60 * 1000) return;
  ticking = true;
  lastTick = now.getTime();
  try {
    for (const ws of await store.workspacesWithLeads()) {
      await runFollowUps(ws, now).catch((err) => console.warn(`[leads] follow-ups (${ws}): ${err.message}`));
      await runDailySummary(ws, now).catch((err) => console.warn(`[leads] summary (${ws}): ${err.message}`));
    }
  } catch (err) {
    if (err.code !== 'MIGRATION_MISSING') console.warn(`[leads] tick: ${err.message}`);
  } finally {
    ticking = false;
  }
}

// ---------- the Leads page ----------

const NEED_LABELS = { website: 'Website', ecommerce: 'E-commerce', design: 'Design', ai_assistant: 'AI assistant', seo: 'SEO', other: 'Other' };
function needLabel(n) { return NEED_LABELS[n] || n || ''; }

const sheetCache = new Map(); // workspaceId -> { at, rows, error }
async function scrapedLeads(workspaceId) {
  const hit = sheetCache.get(workspaceId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit;
  let out;
  try {
    const sheets = require('../googleSheets');
    if (!(await sheets.isConfigured(workspaceId))) out = { rows: [], error: null, configured: false };
    else out = { rows: await sheets.readLeads({ workspaceId }), error: null, configured: true };
  } catch (err) {
    out = { rows: [], error: err.message, configured: true };
  }
  out.at = Date.now();
  sheetCache.set(workspaceId, out);
  return out;
}
const scrapedKey = (r) => (r.email || r.phone || r.name || `row-${r.row}`).toLowerCase().trim();

/** Everything for the Leads page: WhatsApp leads + the Sheet's scraped leads (with your notes/status). */
async function listForPage(workspaceId) {
  const all = await store.listLeads(workspaceId);
  const whatsapp = all.filter((l) => l.source === 'whatsapp').map((l) => ({
    id: l.id, source: 'whatsapp', name: l.name || l.contact_name || null, contactName: l.contact_name, number: l.contact_number,
    email: null, need: l.need, businessType: l.business_type, budget: l.budget, timeline: l.timeline, location: l.location,
    status: l.status, statusSetBy: l.status_set_by, summary: l.summary, notes: l.notes, lastMessageAt: l.last_message_at,
    createdAt: l.created_at, followUpsSent: l.followups_sent || 0, lastFollowUpAt: l.last_followup_at,
  }));
  const overlays = new Map(all.filter((l) => l.source === 'scraped').map((l) => [l.external_key, l]));
  const sheet = await scrapedLeads(workspaceId);
  const scraped = sheet.rows.map((r) => {
    const key = scrapedKey(r);
    const o = overlays.get(key) || {};
    return {
      id: `scraped:${key}`, source: 'scraped', name: r.name || null, number: r.phone || null, email: r.email || null,
      need: o.need || null, status: o.status || 'new', statusSetBy: o.status_set_by || null, summary: r.notes || null,
      notes: o.notes || null, lastMessageAt: null, createdAt: r.date || null, followUpsSent: 0, sheetSource: r.source || null,
    };
  });
  return { leads: [...whatsapp, ...scraped], sheet: { configured: sheet.configured, error: sheet.error, count: scraped.length } };
}

/** You change a lead (status, notes, name, need) - WhatsApp or scraped. */
async function updateByOwner(workspaceId, id, input = {}) {
  const errors = [];
  const patch = {};
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) errors.push(`Status must be one of: ${STATUSES.join(', ')}.`);
    else { patch.status = input.status; patch.status_set_by = 'owner'; }
  }
  if (input.need !== undefined) {
    if (input.need && !NEEDS.includes(input.need)) errors.push(`Need must be one of: ${NEEDS.join(', ')}.`);
    else patch.need = input.need || null;
  }
  if (input.notes !== undefined) {
    if (String(input.notes || '').length > 4000) errors.push('The notes are too long (max 4000 characters).');
    else patch.notes = String(input.notes || '').trim() || null;
  }
  if (input.name !== undefined) patch.name = String(input.name || '').trim().slice(0, 80) || null;
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { code: 'INVALID', details: errors });
  if (!Object.keys(patch).length) throw Object.assign(new Error('Nothing to change.'), { code: 'INVALID', details: ['Nothing to change.'] });

  if (String(id).startsWith('scraped:')) {
    // Saved in the app only - the Google Sheet is never changed, and scraped leads are never messaged.
    const key = String(id).slice('scraped:'.length);
    const existing = await store.findScraped(workspaceId, key);
    const saved = existing
      ? await store.updateLead(workspaceId, existing.id, patch)
      : await store.createLead(workspaceId, { source: 'scraped', external_key: key, ...patch });
    return { ...saved, id };
  }
  const saved = await store.updateLead(workspaceId, id, patch);
  if (!saved) throw Object.assign(new Error('That lead was not found.'), { code: 'NOT_FOUND' });
  return saved;
}

function validateSettings(input = {}) {
  const errors = [];
  const v = {};
  for (const k of ['followups_enabled', 'ask_before_followup', 'daily_summary']) if (input[k] !== undefined) v[k] = !!input[k];
  const int = (k, min, max, label) => {
    if (input[k] === undefined) return;
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${label} must be a whole number from ${min} to ${max}.`);
    else v[k] = n;
  };
  int('first_followup_days', 1, 30, 'First follow-up (days)');
  int('second_followup_days', 2, 60, 'Second follow-up (days)');
  int('summary_hour', 0, 23, 'Summary time (hour)');
  if (v.first_followup_days && v.second_followup_days && v.second_followup_days <= v.first_followup_days) {
    errors.push('The second follow-up must come after the first.');
  }
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { code: 'INVALID', details: errors });
  return v;
}

module.exports = {
  recordInbound, applyFromAgent, recordOutbound, normalizeInfo,
  followUpDue, blockedReason, draftFollowUp, followUp, runFollowUps, canFollowUpNow, localNow,
  buildSummary, runDailySummary, tick,
  listForPage, updateByOwner, validateSettings, scrapedLeads, needLabel,
  STATUSES, NEEDS, MAX_FOLLOWUPS,
  _resetTick: () => { lastTick = 0; ticking = false; },
  _clearSheetCache: () => sheetCache.clear(),
};
