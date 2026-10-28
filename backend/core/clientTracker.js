const { v4: uuid } = require('uuid');
const memory = require('../memory');
const { selectProvider } = require('./router');

/**
 * Client tracker: Gmail + Google Sheets + Google Calendar outreach, per
 * workspace, through the workspace's own Composio connections (gmail,
 * googlesheets, googlecalendar). The Google Sheet is the single source of
 * truth - lead state lives in its "Client Tracker" tab, every action goes to
 * "Activity Log", and opt-outs go to "Do Not Contact".
 *
 * Privacy: the agent only ever lists threads matching the "CodeCraft
 * Outreach" label, and of those only touches threads it started for a lead in
 * the sheet. Nothing else in the inbox is fetched, logged or stored. Reply
 * text is classified in memory and never written anywhere - the sheet and
 * the log only get the outcome (e.g. "interested").
 *
 * Settings live in the workspace's "clienttracker" workspace_connections row
 * (provider_meta), the same table the other connections use.
 */

const PROVIDER = 'clienttracker';
const LABEL_NAME = 'CodeCraft Outreach';
const OPT_OUT_LINE = 'If you\'d rather not hear from us, just reply "stop" and we won\'t email you again.';
const OPT_OUT_CONFIRMATION = 'Understood, you won\'t hear from us again.';
const MAX_FOLLOW_UPS = 2;
const FOLLOW_UP_DAYS = 3;

const TABS = { tracker: 'Client Tracker', activity: 'Activity Log', dnc: 'Do Not Contact' };

const STAGES = {
  CONTACTED: 'Contacted',
  REPLIED: 'Replied',
  BOOKED: 'Booked',
  FOLLOW_UP_SENT: 'Follow-up Sent',
  MANUAL: 'Manual Handling',
  NEEDS_REVIEW: 'Needs Review',
  DNC: 'Do Not Contact',
  CLOSED: 'Closed',
};

// A..H are the columns you work with; I..O are the agent's own bookkeeping
// (kept in the sheet so the sheet stays the only place state lives).
const TRACKER_HEADER = [
  'Name', 'Email', 'Company', 'Stage', 'Last Contact Date', 'Next Follow-up Date', 'Calendar Event Link', 'Notes',
  'High Value', 'Follow-ups Sent', 'Thread ID', 'Agent Message IDs', 'Proposed Slots', 'Automation', 'Last Seen At',
];
const FIELDS = [
  'name', 'email', 'company', 'stage', 'lastContact', 'nextFollowUp', 'eventLink', 'notes',
  'highValue', 'followUps', 'threadId', 'agentMessageIds', 'proposedSlots', 'automation', 'lastSeenAt',
];
const LAST_COL = 'O';
const ACTIVITY_HEADER = ['Timestamp', 'Lead Email', 'Action', 'Result', 'Details'];
const DNC_HEADER = ['Email', 'Date Added', 'Reason'];

// Automation column values.
const AUTO = { ON: '', PAUSED: 'paused', AWAITING_APPROVAL: 'awaiting approval', STOPPED: 'stopped' };

const DEFAULTS = {
  daily_cap: Number(process.env.CLIENT_TRACKER_DAILY_CAP) || 30,
  timezone: process.env.CLIENT_TRACKER_TIMEZONE || 'UTC',
  work_start: process.env.CLIENT_TRACKER_WORK_START || '09:00',
  work_end: process.env.CLIENT_TRACKER_WORK_END || '17:00',
  meeting_minutes: Number(process.env.CLIENT_TRACKER_MEETING_MINUTES) || 30,
  follow_up_time: process.env.CLIENT_TRACKER_FOLLOWUP_TIME || '09:00',
  meeting_title: 'Intro call',
};

class TrackerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrackerError';
  }
}

// ---------------------------------------------------------------------------
// Retries
// ---------------------------------------------------------------------------

let retryDelayMs = 1000; // test hook shortens this

function isRateLimit(err) {
  return /429|rate ?limit|quota|too many requests|userRateLimitExceeded/i.test(err?.message || '');
}
function isTransient(err) {
  return isRateLimit(err) || /\b5\d\d\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|backend error|internal error/i.test(err?.message || '');
}

/**
 * Runs fn with up to 3 attempts and exponential backoff. A send is only
 * retried on a rate limit (the request was refused, so nothing went out) -
 * a 5xx on a send might have delivered, and a second try could double-send.
 */
async function withRetry(fn, { isSend = false, attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err?.code === 'WORKSPACE_CONNECTION_MISSING') throw err;
      const retryable = isSend ? isRateLimit(err) : isTransient(err);
      if (!retryable || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

const SEND_SLUGS = new Set(['GMAIL_SEND_EMAIL', 'GMAIL_REPLY_TO_THREAD', 'GOOGLECALENDAR_CREATE_EVENT']);

function call(workspaceId, slug, args, toolkit) {
  return withRetry(
    () => require('./composio').execute(slug, args, toolkit, { workspaceId }),
    { isSend: SEND_SLUGS.has(slug) }
  );
}

// Composio wraps the Google payload differently per action/version.
function unwrap(d, key) {
  for (const c of [d, d?.data, d?.response_data, d?.data?.response_data, d?.response_data?.data]) {
    if (c && typeof c === 'object' && key in c) return c;
  }
  return d || {};
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings(workspaceId) {
  const row = await require('./workspaceConnections').getConnection(workspaceId, PROVIDER);
  return { ...DEFAULTS, enabled: false, ...(row?.provider_meta || {}) };
}

async function saveSettings(workspaceId, patch) {
  const current = await getSettings(workspaceId);
  const next = { ...current, ...patch };
  await require('./workspaceConnections').upsertConnection(workspaceId, PROVIDER, {
    status: 'connected',
    provider_meta: next,
  });
  return next;
}

const ALLOWED_SETTINGS = ['daily_cap', 'timezone', 'work_start', 'work_end', 'meeting_minutes', 'follow_up_time', 'meeting_title', 'enabled'];

function validateSettings(input = {}) {
  const out = {};
  for (const k of ALLOWED_SETTINGS) if (input[k] !== undefined) out[k] = input[k];
  if (out.daily_cap !== undefined) {
    out.daily_cap = Number(out.daily_cap);
    if (!Number.isInteger(out.daily_cap) || out.daily_cap < 1 || out.daily_cap > 500) throw new TrackerError('Daily email cap must be a whole number from 1 to 500.');
  }
  for (const k of ['work_start', 'work_end', 'follow_up_time']) {
    if (out[k] !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(out[k])) throw new TrackerError(`${k} must look like 09:00.`);
  }
  if (out.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: out.timezone }); } catch { throw new TrackerError(`Unknown timezone "${out.timezone}" - use a name like Africa/Accra.`); }
  }
  if (out.meeting_minutes !== undefined) {
    out.meeting_minutes = Number(out.meeting_minutes);
    if (![15, 20, 30, 45, 60].includes(out.meeting_minutes)) throw new TrackerError('Meeting length must be 15, 20, 30, 45 or 60 minutes.');
  }
  if (out.enabled !== undefined) out.enabled = !!out.enabled;
  return out;
}

// ---------------------------------------------------------------------------
// Dates (workspace timezone, no extra libraries)
// ---------------------------------------------------------------------------

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    year: +get('year'), month: +get('month'), day: +get('day'),
    hour: +get('hour'), minute: +get('minute'), second: +get('second'), weekday: get('weekday'),
  };
}

/** 'YYYY-MM-DD' for `date` in `timeZone`. */
function dateInTz(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The UTC instant for a wall-clock time in `timeZone`. */
function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = zonedParts(new Date(guess), timeZone);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
  return new Date(guess - offset);
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Local wall time without offset, the shape Calendar's create action takes with a timezone. */
function localIso(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`;
}

function formatSlot(iso, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso)) + ` (${timeZone})`;
}

/**
 * Pure: up to `count` open slots in the next `days` days, inside working
 * hours on weekdays, not overlapping `busy` ([{start,end}] ISO), at least 2
 * hours from now. Prefers one slot per day so the options are spread out.
 */
function pickSlots(busy, { now = new Date(), timeZone = 'UTC', workStart = '09:00', workEnd = '17:00', minutes = 30, count = 3, days = 7 } = {}) {
  const ranges = (busy || []).map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  const earliest = now.getTime() + 2 * 60 * 60 * 1000;
  const [sh, sm] = workStart.split(':').map(Number);
  const [eh, em] = workEnd.split(':').map(Number);
  const step = 30 * 60 * 1000;
  const len = minutes * 60 * 1000;
  const today = dateInTz(now, timeZone);
  const perDay = [];
  for (let i = 0; i <= days; i++) {
    const [y, m, d] = addDays(today, i).split('-').map(Number);
    const dayStart = zonedToUtc(y, m, d, sh, sm, timeZone).getTime();
    const dayEnd = zonedToUtc(y, m, d, eh, em, timeZone).getTime();
    const weekday = zonedParts(new Date(dayStart), timeZone).weekday;
    if (weekday === 'Sat' || weekday === 'Sun') continue;
    const free = [];
    for (let t = dayStart; t + len <= dayEnd; t += step) {
      if (t < earliest || t > now.getTime() + days * 86400000) continue;
      if (ranges.some(([bs, be]) => t < be && t + len > bs)) continue;
      free.push(new Date(t).toISOString());
    }
    if (free.length) perDay.push(free);
  }
  const picked = perDay.map((f) => f[0]).slice(0, count);
  // Fewer open days than needed: fill from the remaining slots, in order.
  for (const f of perDay) for (const s of f.slice(1)) if (picked.length < count && !picked.includes(s)) picked.push(s);
  return picked.sort();
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

const q = (title) => `'${String(title).replace(/'/g, "''")}'`;
const norm = (v) => String(v || '').trim().toLowerCase().replace(/[.,;:]+$/, '');
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function sheetsFor(workspaceId) {
  const googleSheets = require('./googleSheets');
  const spreadsheetId = await googleSheets.resolveSheetId(workspaceId);
  const { sheets } = await googleSheets.getClient(workspaceId);
  return { sheets, spreadsheetId };
}

async function getValues(workspaceId, range) {
  const { sheets, spreadsheetId } = await sheetsFor(workspaceId);
  const res = await withRetry(() => sheets.spreadsheets.values.get({ spreadsheetId, range }));
  return res?.data?.values || [];
}

async function setValues(workspaceId, range, values) {
  const { sheets, spreadsheetId } = await sheetsFor(workspaceId);
  await withRetry(() => sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values } }));
}

async function appendValues(workspaceId, range, values) {
  const { sheets, spreadsheetId } = await sheetsFor(workspaceId);
  // Appends aren't idempotent either - retry only when Google refused it.
  await withRetry(
    () => sheets.spreadsheets.values.append({ spreadsheetId, range, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values } }),
    { isSend: true }
  );
}

/** Creates the three tabs (and their header rows) when they're missing. */
async function ensureTabs(workspaceId) {
  const { sheets, spreadsheetId } = await sheetsFor(workspaceId);
  const meta = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId }));
  const titles = new Set((meta?.data?.sheets || []).map((s) => s?.properties?.title));
  const created = [];
  for (const [title, header] of [[TABS.tracker, TRACKER_HEADER], [TABS.activity, ACTIVITY_HEADER], [TABS.dnc, DNC_HEADER]]) {
    if (!titles.has(title)) {
      await call(workspaceId, 'GOOGLESHEETS_ADD_SHEET', { spreadsheet_id: spreadsheetId, title, force_unique: false }, 'googlesheets');
      created.push(title);
    }
    const lastCol = String.fromCharCode(64 + header.length);
    const head = await getValues(workspaceId, `${q(title)}!A1:${lastCol}1`);
    if (!(head[0] || []).some((c) => String(c || '').trim())) {
      await setValues(workspaceId, `${q(title)}!A1:${lastCol}1`, [header]);
    }
  }
  return created;
}

function rowToLead(row, rowNumber) {
  const lead = { rowNumber };
  FIELDS.forEach((f, i) => { lead[f] = String(row[i] ?? '').trim(); });
  lead.followUps = Number(lead.followUps) || 0;
  lead.highValue = /^(y|yes|true|1|high)$/i.test(lead.highValue);
  lead.agentMessageIds = lead.agentMessageIds ? lead.agentMessageIds.split(/[\s,]+/).filter(Boolean) : [];
  lead.lastSeenAt = Number(lead.lastSeenAt) || 0;
  return lead;
}

function leadToRow(lead) {
  return FIELDS.map((f) => {
    const v = lead[f];
    if (f === 'highValue') return v ? 'yes' : '';
    if (f === 'agentMessageIds') return (v || []).join(',');
    if (f === 'followUps') return String(v || 0);
    if (f === 'lastSeenAt') return v ? String(v) : '';
    return v == null ? '' : String(v);
  });
}

async function readLeads(workspaceId) {
  const rows = await getValues(workspaceId, `${q(TABS.tracker)}!A2:${LAST_COL}`);
  return rows.map((r, i) => rowToLead(r, i + 2)).filter((l) => l.email || l.name);
}

async function writeLead(workspaceId, lead) {
  await setValues(workspaceId, `${q(TABS.tracker)}!A${lead.rowNumber}:${LAST_COL}${lead.rowNumber}`, [leadToRow(lead)]);
}

function addNote(lead, note) {
  if (String(lead.notes || '').includes(note)) return;
  lead.notes = lead.notes ? `${lead.notes}; ${note}` : note;
}

async function logActivity(workspaceId, email, action, result, details = '') {
  try {
    await appendValues(workspaceId, `${q(TABS.activity)}!A:E`, [[new Date().toISOString(), email || '', action, result, String(details || '').slice(0, 500)]]);
  } catch (err) {
    console.warn(`[clientTracker] activity log write failed: ${err.message}`);
  }
}

async function readDoNotContact(workspaceId) {
  const rows = await getValues(workspaceId, `${q(TABS.dnc)}!A2:A`);
  return new Set(rows.map((r) => norm(r[0])).filter(Boolean));
}

async function addDoNotContact(workspaceId, email, reason, timeZone) {
  const dnc = await readDoNotContact(workspaceId);
  if (dnc.has(norm(email))) return false;
  await appendValues(workspaceId, `${q(TABS.dnc)}!A:C`, [[norm(email), dateInTz(new Date(), timeZone), reason]]);
  return true;
}

// ---------------------------------------------------------------------------
// Gmail helpers
// ---------------------------------------------------------------------------

function extractEmail(from) {
  const m = String(from || '').match(/[^\s<>"']+@[^\s<>"']+/);
  return m ? norm(m[0]) : '';
}

async function ensureLabel(workspaceId, settings) {
  if (settings.label_id) return settings.label_id;
  const res = await call(workspaceId, 'GMAIL_LIST_LABELS', {}, 'gmail');
  const labels = unwrap(res, 'labels').labels || [];
  let label = labels.find((l) => norm(l.name) === norm(LABEL_NAME));
  if (!label) {
    const created = await call(workspaceId, 'GMAIL_CREATE_LABEL', { label_name: LABEL_NAME }, 'gmail');
    label = unwrap(created, 'id');
  }
  if (!label?.id) throw new TrackerError(`Couldn't create the Gmail label "${LABEL_NAME}".`);
  await saveSettings(workspaceId, { label_id: label.id });
  return label.id;
}

async function ensureMyEmail(workspaceId, settings) {
  if (settings.my_email) return settings.my_email;
  const res = await call(workspaceId, 'GMAIL_GET_PROFILE', {}, 'gmail');
  const email = norm(unwrap(res, 'emailAddress').emailAddress || unwrap(res, 'email_address').email_address);
  if (!email) throw new TrackerError('Couldn\'t read the connected Gmail address.');
  await saveSettings(workspaceId, { my_email: email });
  return email;
}

function messageBody(m) {
  if (m.messageText) return m.messageText;
  if (m.preview?.body) return m.preview.body;
  const decode = (data) => Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const walk = (part) => {
    if (!part) return '';
    if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
    for (const p of part.parts || []) { const t = walk(p); if (t) return t; }
    return '';
  };
  return walk(m.payload) || m.snippet || '';
}

/** Drops the quoted earlier conversation so only the new reply is classified. */
function stripQuoted(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^\s*On .+wrote:\s*$/.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^\s*From: .+/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

const messageTime = (m) => Number(m.internalDate || 0) || new Date(m.messageTimestamp || m.date || 0).getTime() || 0;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const CLEAR_OPT_OUT = /\b(unsubscribe|remove me|take me off|opt[ -]?out|stop (emailing|contacting|messaging|sending)|do not (contact|email)|don'?t (contact|email|message)|no more emails)\b/i;

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * interested | not_interested | question | opt_out | unclear_opt_out.
 * A clear opt-out phrase (or a bare "stop") never depends on the AI.
 */
async function classifyReply(text) {
  const clean = stripQuoted(text);
  if (/^\W*stop\W*$/i.test(clean) || CLEAR_OPT_OUT.test(clean)) return 'opt_out';
  const provider = selectProvider({});
  const result = await provider.complete({
    system:
      'You classify a reply to a sales outreach email. Respond with ONLY JSON: {"intent": "..."} where intent is one of: ' +
      '"interested" (wants to talk, a call, or more info), "not_interested" (declines but does not ask to stop contact), ' +
      '"question" (asks something before deciding), "opt_out" (clearly asks to stop being contacted), ' +
      '"unclear_opt_out" (might be asking to stop, but you cannot be sure). When unsure between opt_out and anything else, use "unclear_opt_out".',
    prompt: `Reply:\n${clean.slice(0, 2000)}`,
  });
  const intent = parseJson(result?.text)?.intent;
  const ok = ['interested', 'not_interested', 'question', 'opt_out', 'unclear_opt_out'];
  if (ok.includes(intent)) return intent;
  // Unknown answer: a mention of "stop" is treated as a possible opt-out, never ignored.
  return /\bstop\b/i.test(clean) ? 'unclear_opt_out' : 'question';
}

/** Which proposed slot (index) the lead picked, or null. */
async function pickChosenSlot(text, slots, timeZone) {
  const clean = stripQuoted(text);
  const bare = clean.match(/^\W*(?:option\s*)?#?([1-9])\W*$/i);
  if (bare && Number(bare[1]) <= slots.length) return Number(bare[1]) - 1;
  const provider = selectProvider({});
  const list = slots.map((s, i) => `${i + 1}. ${formatSlot(s, timeZone)}`).join('\n');
  const result = await provider.complete({
    system: 'A lead was offered meeting times and replied. Respond with ONLY JSON {"choice": n} where n is the option number they accepted, or {"choice": null} if they did not clearly accept one.',
    prompt: `Options:\n${list}\n\nReply:\n${clean.slice(0, 1500)}`,
  });
  const n = Number(parseJson(result?.text)?.choice);
  return Number.isInteger(n) && n >= 1 && n <= slots.length ? n - 1 : null;
}

// ---------------------------------------------------------------------------
// Sending - every send goes through guardedSend
// ---------------------------------------------------------------------------

const SEND_ACTIONS = new Set(['email_sent']);

async function sentToday(workspaceId, timeZone) {
  const today = dateInTz(new Date(), timeZone);
  const rows = await getValues(workspaceId, `${q(TABS.activity)}!A2:D`);
  return rows.filter((r) => r[0] && dateInTz(new Date(r[0]), timeZone) === today && SEND_ACTIONS.has(r[2]) && r[3] === 'sent').length;
}

function fillTemplate(text, lead) {
  const first = String(lead.name || '').split(/\s+/)[0] || 'there';
  return String(text || '')
    .replace(/\{\{\s*first_?name\s*\}\}/gi, first)
    .replace(/\{\{\s*name\s*\}\}/gi, lead.name || first)
    .replace(/\{\{\s*company\s*\}\}/gi, lead.company || 'your company');
}

/**
 * The one path every email takes. Order of checks:
 *   1. Do Not Contact tab (outreach / follow-up / slots) -> blocked + logged
 *   2. lead paused (Manual Handling, Needs Review, awaiting approval, stopped) -> blocked
 *   3. high-value lead without approval -> approval task, nothing sent
 *   4. daily cap -> blocked + logged
 *   5. send, label "CodeCraft Outreach", record message id, log
 * `kind`: outreach | followup | slots | optout_confirmation.
 */
async function guardedSend(workspaceId, lead, { kind, subject, body }, { approved = false, settings = null } = {}) {
  settings = settings || await getSettings(workspaceId);
  const email = norm(lead.email);
  const isConfirmation = kind === 'optout_confirmation';

  if (!isConfirmation) {
    const dnc = await readDoNotContact(workspaceId);
    if (dnc.has(email) || lead.stage === STAGES.DNC) {
      await logActivity(workspaceId, email, `${kind}_blocked`, 'blocked', 'Address is on the Do Not Contact list');
      return { status: 'blocked', reason: 'do_not_contact' };
    }
    const paused = [STAGES.MANUAL, STAGES.NEEDS_REVIEW, STAGES.CLOSED].includes(lead.stage)
      || lead.automation === AUTO.PAUSED || lead.automation === AUTO.STOPPED
      || (lead.automation === AUTO.AWAITING_APPROVAL && !approved);
    if (paused) {
      await logActivity(workspaceId, email, `${kind}_blocked`, 'blocked', `Automation paused for this lead (${lead.stage || lead.automation})`);
      return { status: 'blocked', reason: 'paused' };
    }
    // Asking for approval sends nothing; the cap is checked when the approved send runs.
    if (lead.highValue && !approved) {
      await requestApproval(workspaceId, lead, { kind, subject, body });
      return { status: 'pending_approval' };
    }
    const count = await sentToday(workspaceId, settings.timezone);
    if (count >= Number(settings.daily_cap)) {
      await logActivity(workspaceId, email, `${kind}_blocked`, 'blocked', `Daily email cap reached (${settings.daily_cap})`);
      return { status: 'blocked', reason: 'daily_cap' };
    }
  }

  const fullBody = isConfirmation ? body : `${body.trim()}\n\n${OPT_OUT_LINE}`;
  const labelId = await ensureLabel(workspaceId, settings);
  let res;
  try {
    res = lead.threadId
      ? await call(workspaceId, 'GMAIL_REPLY_TO_THREAD', { thread_id: lead.threadId, recipient_email: email, message_body: fullBody }, 'gmail')
      : await call(workspaceId, 'GMAIL_SEND_EMAIL', { recipient_email: email, subject, body: fullBody }, 'gmail');
  } catch (err) {
    await logActivity(workspaceId, email, kind, 'failed', err.message);
    throw err;
  }
  const sent = unwrap(res, 'id');
  const messageId = sent.id || sent.messageId || null;
  const threadId = sent.threadId || lead.threadId || null;
  if (messageId) {
    try {
      await call(workspaceId, 'GMAIL_ADD_LABEL_TO_EMAIL', { message_id: messageId, add_label_ids: [labelId] }, 'gmail');
    } catch (err) {
      await logActivity(workspaceId, email, 'label_failed', 'failed', err.message);
    }
  }
  lead.threadId = threadId || '';
  if (messageId) lead.agentMessageIds = [...(lead.agentMessageIds || []), messageId].slice(-20);
  lead.lastContact = dateInTz(new Date(), settings.timezone);
  if (lead.automation === AUTO.AWAITING_APPROVAL) lead.automation = AUTO.ON;
  await logActivity(workspaceId, email, 'email_sent', 'sent', `${kind}${subject ? `: ${subject}` : ''}`);
  return { status: 'sent', messageId, threadId };
}

/** Pending approval task (shows on the Approvals page) for a high-value lead. */
async function requestApproval(workspaceId, lead, { kind, subject, body }) {
  const task = {
    id: uuid(),
    agent: 'client-tracker',
    instruction: `Send ${kind === 'followup' ? 'a follow-up' : kind === 'slots' ? 'meeting times' : 'an outreach email'} to high-value lead ${lead.name || lead.email} <${lead.email}>`,
    status: 'pending_approval',
    irreversible: true,
    toolCall: { tool: 'clienttracker.sendApproved', irreversible: true },
    payload: { email: lead.email, kind, subject: subject || '', body },
    created_at: new Date().toISOString(),
    workspace_id: workspaceId,
  };
  await memory.saveTask(task, { workspaceId });
  lead.automation = AUTO.AWAITING_APPROVAL;
  await writeLead(workspaceId, lead);
  await logActivity(workspaceId, lead.email, `${kind}_approval_requested`, 'pending', 'High-value lead - waiting for your approval');
  return task;
}

/** Stage changes after a successful send of each kind. */
function applyAfterSend(lead, kind, settings, extra = {}) {
  const today = dateInTz(new Date(), settings.timezone);
  if (kind === 'outreach') {
    lead.stage = STAGES.CONTACTED;
    lead.followUps = 0;
    lead.nextFollowUp = addDays(today, FOLLOW_UP_DAYS);
  } else if (kind === 'followup') {
    lead.followUps = (lead.followUps || 0) + 1;
    lead.stage = STAGES.FOLLOW_UP_SENT;
    lead.nextFollowUp = lead.followUps < MAX_FOLLOW_UPS ? addDays(today, FOLLOW_UP_DAYS) : '';
  } else if (kind === 'slots') {
    if (extra.slots) lead.proposedSlots = extra.slots.join('|');
    lead.nextFollowUp = '';
    addNote(lead, 'Meeting times sent');
  }
}

/** Called by the approval flow (plugins/clienttracker/actions/sendApproved.js). */
async function sendApproved(workspaceId, { email, kind, subject, body }) {
  const settings = await getSettings(workspaceId);
  const lead = (await readLeads(workspaceId)).find((l) => norm(l.email) === norm(email));
  if (!lead) throw new TrackerError(`${email} is no longer in the Client Tracker sheet.`);
  const result = await guardedSend(workspaceId, lead, { kind, subject, body }, { approved: true, settings });
  if (result.status === 'sent') {
    applyAfterSend(lead, kind, settings, { slots: kind === 'slots' ? lead.proposedSlots.split('|').filter(Boolean) : null });
    await writeLead(workspaceId, lead);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

async function requireReady(workspaceId) {
  if (!workspaceId) throw new TrackerError('No workspace.');
  const status = await require('./googleSheets').sheetsStatus(workspaceId);
  if (!status.ok) throw new TrackerError(status.reason || 'Connect Google Sheets and choose a sheet first.');
  const gmail = await require('./workspaceConnections').getConnection(workspaceId, 'gmail');
  if (gmail?.status !== 'connected') throw new TrackerError('Connect Gmail on the Connections page first.');
  return getSettings(workspaceId);
}

/** Creates the tabs + Gmail label and turns the tracker on. */
async function setup(workspaceId, input = {}) {
  await requireReady(workspaceId);
  const patch = validateSettings(input);
  let settings = await saveSettings(workspaceId, { ...patch, enabled: patch.enabled ?? true });
  const createdTabs = await ensureTabs(workspaceId);
  await ensureLabel(workspaceId, settings);
  await ensureMyEmail(workspaceId, settings);
  settings = await getSettings(workspaceId);
  await logActivity(workspaceId, '', 'tracker_setup', 'ok', createdTabs.length ? `Created tabs: ${createdTabs.join(', ')}` : 'Tabs already present');
  return { settings, createdTabs };
}

/**
 * Adds leads ({name, email, company, highValue, notes}) to the tracker.
 * Skips invalid emails, duplicates, and - always - anything on Do Not Contact.
 */
async function importLeads(workspaceId, leads = []) {
  await requireReady(workspaceId);
  await ensureTabs(workspaceId);
  const dnc = await readDoNotContact(workspaceId);
  const existing = new Set((await readLeads(workspaceId)).map((l) => norm(l.email)));
  const rows = [];
  const skipped = [];
  for (const raw of leads) {
    const email = norm(raw?.email);
    if (!EMAIL_RE.test(email)) { skipped.push({ email: raw?.email || '', reason: 'invalid email' }); continue; }
    if (dnc.has(email)) {
      skipped.push({ email, reason: 'on Do Not Contact list' });
      await logActivity(workspaceId, email, 'import_blocked', 'blocked', 'Address is on the Do Not Contact list');
      continue;
    }
    if (existing.has(email)) { skipped.push({ email, reason: 'already in tracker' }); continue; }
    existing.add(email);
    rows.push(leadToRow({
      name: String(raw.name || '').trim(), email, company: String(raw.company || '').trim(), stage: '',
      notes: String(raw.notes || '').trim(), highValue: !!raw.highValue && !/^(no|false|0)$/i.test(String(raw.highValue)),
      followUps: 0, agentMessageIds: [],
    }));
  }
  if (rows.length) await appendValues(workspaceId, `${q(TABS.tracker)}!A:${LAST_COL}`, rows);
  await logActivity(workspaceId, '', 'leads_imported', 'ok', `${rows.length} added, ${skipped.length} skipped`);
  return { added: rows.length, skipped };
}

/** Sends the first email to leads with an empty Stage, up to `limit`. */
async function sendOutreach(workspaceId, { subject, body, limit = 10 } = {}) {
  const settings = await requireReady(workspaceId);
  if (!String(subject || '').trim() || !String(body || '').trim()) throw new TrackerError('Outreach needs a subject and a body.');
  const leads = (await readLeads(workspaceId)).filter((l) => !l.stage && !l.threadId && l.email);
  const results = [];
  for (const lead of leads.slice(0, Math.max(1, Math.min(Number(limit) || 10, 100)))) {
    const r = await guardedSend(workspaceId, lead, { kind: 'outreach', subject: fillTemplate(subject, lead), body: fillTemplate(body, lead) }, { settings });
    if (r.status === 'sent') { applyAfterSend(lead, 'outreach', settings); await writeLead(workspaceId, lead); }
    results.push({ email: lead.email, ...r });
    if (r.reason === 'daily_cap') break;
  }
  return summarize(results);
}

function summarize(results) {
  const by = (s) => results.filter((r) => r.status === s).length;
  return { sent: by('sent'), pendingApproval: by('pending_approval'), blocked: by('blocked'), failed: by('failed'), results };
}

async function freeBusy(workspaceId, from, to, timeZone) {
  const res = await call(workspaceId, 'GOOGLECALENDAR_FREE_BUSY_QUERY', {
    timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone, items: [{ id: 'primary' }],
  }, 'googlecalendar');
  const cals = unwrap(res, 'calendars').calendars || {};
  return Object.values(cals).flatMap((c) => c?.busy || []);
}

async function proposeSlots(workspaceId, lead, settings) {
  const now = new Date();
  let busy;
  try {
    busy = await freeBusy(workspaceId, now, new Date(now.getTime() + 7 * 86400000), settings.timezone);
  } catch (err) {
    // The reply is already marked seen - leave a note instead of losing it.
    addNote(lead, 'Interested - couldn\'t read your calendar, please send times manually');
    lead.automation = AUTO.PAUSED;
    await logActivity(workspaceId, lead.email, 'calendar_failed', 'failed', err.message);
    return { status: 'calendar_failed' };
  }
  const slots = pickSlots(busy, {
    now, timeZone: settings.timezone, workStart: settings.work_start, workEnd: settings.work_end, minutes: Number(settings.meeting_minutes),
  });
  if (!slots.length) {
    addNote(lead, 'Interested - no free slots in the next 7 days, please book manually');
    lead.automation = AUTO.PAUSED;
    return { status: 'no_slots' };
  }
  const first = String(lead.name || '').split(/\s+/)[0] || 'there';
  const body = `Hi ${first},\n\nGreat to hear from you. Would any of these times work for a ${settings.meeting_minutes}-minute call?\n\n` +
    slots.map((s, i) => `${i + 1}. ${formatSlot(s, settings.timezone)}`).join('\n') +
    '\n\nJust reply with the number that suits you and I\'ll send a calendar invite with a Google Meet link.';
  lead.proposedSlots = slots.join('|'); // kept even if approval is pending, so sendApproved can record them
  const r = await guardedSend(workspaceId, lead, { kind: 'slots', body }, { settings });
  if (r.status === 'sent') applyAfterSend(lead, 'slots', settings, { slots });
  else if (r.status !== 'pending_approval') lead.proposedSlots = '';
  return r;
}

async function book(workspaceId, lead, slotIso, settings) {
  const minutes = Number(settings.meeting_minutes);
  const res = await call(workspaceId, 'GOOGLECALENDAR_CREATE_EVENT', {
    calendar_id: 'primary',
    summary: `${settings.meeting_title || 'Intro call'} - ${lead.name || lead.email}`,
    description: `Booked by CodeCraft for ${lead.name || lead.email}${lead.company ? ` (${lead.company})` : ''}.`,
    start_datetime: localIso(new Date(slotIso), settings.timezone),
    timezone: settings.timezone,
    ...(minutes >= 60 ? { event_duration_hour: Math.floor(minutes / 60), event_duration_minutes: minutes % 60 } : { event_duration_hour: 0, event_duration_minutes: minutes }),
    attendees: [lead.email],
    create_meeting_room: true,
    send_updates: true,
  }, 'googlecalendar');
  const ev = unwrap(res, 'htmlLink');
  lead.stage = STAGES.BOOKED;
  lead.eventLink = ev.htmlLink || ev.hangoutLink || '';
  lead.proposedSlots = '';
  lead.nextFollowUp = '';
  addNote(lead, `Booked ${formatSlot(slotIso, settings.timezone)}${ev.hangoutLink ? ` - Meet: ${ev.hangoutLink}` : ''}`);
  await logActivity(workspaceId, lead.email, 'meeting_booked', 'ok', formatSlot(slotIso, settings.timezone));
}

async function handleOptOut(workspaceId, lead, settings) {
  lead.stage = STAGES.DNC;
  lead.nextFollowUp = '';
  lead.proposedSlots = '';
  lead.automation = AUTO.STOPPED;
  await addDoNotContact(workspaceId, lead.email, 'Opted out by reply', settings.timezone);
  await logActivity(workspaceId, lead.email, 'opt_out', 'ok', 'Added to Do Not Contact, follow-ups cancelled');
  await guardedSend(workspaceId, lead, { kind: 'optout_confirmation', body: OPT_OUT_CONFIRMATION }, { settings });
  lead.automation = AUTO.STOPPED;
}

/** What to do with one new reply from the lead's own address. */
async function handleLeadReply(workspaceId, lead, text, settings) {
  lead.stage = STAGES.REPLIED;
  lead.lastContact = dateInTz(new Date(), settings.timezone);
  lead.nextFollowUp = '';

  const slots = lead.proposedSlots ? lead.proposedSlots.split('|').filter(Boolean) : [];
  if (slots.length) {
    const chosen = await pickChosenSlot(text, slots, settings.timezone);
    if (chosen != null) {
      try {
        await book(workspaceId, lead, slots[chosen], settings);
        return 'booked';
      } catch (err) {
        addNote(lead, `Picked ${formatSlot(slots[chosen], settings.timezone)} but booking failed - please book manually`);
        lead.automation = AUTO.PAUSED;
        await logActivity(workspaceId, lead.email, 'booking_failed', 'failed', err.message);
        return 'booking_failed';
      }
    }
  }

  const intent = await classifyReply(text);
  await logActivity(workspaceId, lead.email, 'reply_classified', intent);
  if (intent === 'opt_out') {
    await handleOptOut(workspaceId, lead, settings);
  } else if (intent === 'unclear_opt_out') {
    lead.stage = STAGES.NEEDS_REVIEW;
    lead.automation = AUTO.PAUSED;
    addNote(lead, 'Reply may be an opt-out - automation paused until you decide');
  } else if (intent === 'interested') {
    addNote(lead, 'Interested');
    await proposeSlots(workspaceId, lead, settings);
  } else if (intent === 'not_interested') {
    lead.stage = STAGES.CLOSED;
    addNote(lead, 'Not interested');
  } else {
    lead.automation = AUTO.PAUSED;
    addNote(lead, 'Asked a question - needs your answer');
  }
  return intent;
}

/**
 * Finds replies. Only threads carrying the "CodeCraft Outreach" label are
 * listed, and of those only threads the agent started for a lead in the
 * sheet are opened. Inside a thread:
 *   - your own message the agent didn't send -> Manual Handling, paused
 *   - the lead's address -> classified and handled
 *   - any other address -> "Possible match, needs review", paused, not read further
 */
async function checkReplies(workspaceId) {
  const settings = await requireReady(workspaceId);
  const myEmail = await ensureMyEmail(workspaceId, settings);
  const leads = (await readLeads(workspaceId)).filter((l) => l.threadId && ![STAGES.DNC, STAGES.MANUAL].includes(l.stage));
  if (!leads.length) return { checked: 0, handled: [] };

  const listed = await call(workspaceId, 'GMAIL_LIST_THREADS', { query: `label:"${LABEL_NAME}" newer_than:60d`, max_results: 200 }, 'gmail');
  const labelled = new Set((unwrap(listed, 'threads').threads || []).map((t) => t.id || t.threadId));

  const handled = [];
  for (const lead of leads) {
    if (!labelled.has(lead.threadId)) continue;
    let changed = false;
    try {
      const res = await call(workspaceId, 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID', { thread_id: lead.threadId }, 'gmail');
      const messages = (unwrap(res, 'messages').messages || [])
        .filter((m) => messageTime(m) > lead.lastSeenAt)
        .sort((a, b) => messageTime(a) - messageTime(b));
      for (const m of messages) {
        lead.lastSeenAt = Math.max(lead.lastSeenAt, messageTime(m));
        changed = true;
        const id = m.messageId || m.id;
        const from = extractEmail(m.sender || m.from);
        if (lead.agentMessageIds.includes(id)) continue;
        // Agent mail always carries the opt-out line (or is the confirmation) -
        // a backstop in case Gmail didn't return the message id on send.
        const own = stripQuoted(messageBody(m));
        if (from === myEmail && (own.includes(OPT_OUT_LINE) || own.startsWith(OPT_OUT_CONFIRMATION))) continue;
        if (from === myEmail) {
          lead.stage = STAGES.MANUAL;
          lead.automation = AUTO.PAUSED;
          lead.nextFollowUp = '';
          await logActivity(workspaceId, lead.email, 'manual_reply_detected', 'paused', 'You replied in this thread - automation paused');
          handled.push({ email: lead.email, outcome: 'manual_handling' });
          break;
        }
        if (from === norm(lead.email)) {
          const outcome = await handleLeadReply(workspaceId, lead, messageBody(m), settings);
          handled.push({ email: lead.email, outcome });
          if ([STAGES.DNC, STAGES.NEEDS_REVIEW, STAGES.BOOKED, STAGES.CLOSED].includes(lead.stage)) break;
          continue;
        }
        addNote(lead, `Possible match, needs review (reply from ${from || 'unknown address'})`);
        lead.automation = AUTO.PAUSED;
        lead.nextFollowUp = '';
        await logActivity(workspaceId, lead.email, 'possible_match', 'needs_review', `Reply came from ${from || 'an unknown address'}`);
        handled.push({ email: lead.email, outcome: 'possible_match' });
        break;
      }
    } catch (err) {
      await logActivity(workspaceId, lead.email, 'reply_check_failed', 'failed', err.message);
    }
    if (changed) await writeLead(workspaceId, lead);
  }
  return { checked: leads.length, handled };
}

/** Daily job: follow-ups for leads with no reply after 3 days, at most 2 each. */
async function runFollowUps(workspaceId, { body } = {}) {
  const settings = await requireReady(workspaceId);
  await checkReplies(workspaceId); // never follow up on someone who just replied
  const today = dateInTz(new Date(), settings.timezone);
  const due = (await readLeads(workspaceId)).filter((l) =>
    [STAGES.CONTACTED, STAGES.FOLLOW_UP_SENT].includes(l.stage) && l.threadId && !l.automation
    && l.followUps < MAX_FOLLOW_UPS && l.nextFollowUp && l.nextFollowUp <= today);
  const results = [];
  for (const lead of due) {
    const first = String(lead.name || '').split(/\s+/)[0] || 'there';
    const text = body ? fillTemplate(body, lead) : (lead.followUps === 0
      ? `Hi ${first},\n\nJust following up on my earlier email in case it got buried. Would a short call be useful?`
      : `Hi ${first},\n\nI'll leave it here so I don't fill your inbox. If the timing is better later, just reply to this email.`);
    const r = await guardedSend(workspaceId, lead, { kind: 'followup', body: text }, { settings });
    if (r.status === 'sent') { applyAfterSend(lead, 'followup', settings); await writeLead(workspaceId, lead); }
    results.push({ email: lead.email, ...r });
    if (r.reason === 'daily_cap') break;
  }
  await saveSettings(workspaceId, { last_follow_up_date: today });
  return summarize(results);
}

async function recentActivity(workspaceId, limit = 50) {
  const rows = await getValues(workspaceId, `${q(TABS.activity)}!A2:E`);
  return rows.slice(-limit).reverse().map(([at, email, action, result, details]) => ({ at, email, action, result, details }));
}

async function status(workspaceId) {
  const settings = await getSettings(workspaceId);
  const out = { settings: { ...settings }, leads: null, sentToday: null };
  if (!settings.enabled) return out;
  try {
    const leads = await readLeads(workspaceId);
    out.leads = { total: leads.length, byStage: {} };
    for (const l of leads) out.leads.byStage[l.stage || 'New'] = (out.leads.byStage[l.stage || 'New'] || 0) + 1;
    out.sentToday = await sentToday(workspaceId, settings.timezone);
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scheduler hook
// ---------------------------------------------------------------------------

const running = new Set();
const lastReplyCheck = new Map();

/**
 * Called every scheduler tick. For each workspace with the tracker on:
 * reply check every CLIENT_TRACKER_REPLY_CHECK_MINUTES (default 15, 0 = off),
 * and the follow-up run once a day at follow_up_time in its timezone.
 */
async function tick(now = new Date()) {
  const minutes = process.env.CLIENT_TRACKER_REPLY_CHECK_MINUTES === undefined ? 15 : Number(process.env.CLIENT_TRACKER_REPLY_CHECK_MINUTES);
  let rows;
  try {
    rows = await memory.listConnectionsByProvider(PROVIDER);
  } catch (err) {
    console.warn(`[clientTracker] could not list workspaces: ${err.message}`);
    return;
  }
  for (const row of rows || []) {
    const ws = row.workspace_id;
    const s = { ...DEFAULTS, ...(row.provider_meta || {}) };
    if (!s.enabled || running.has(ws)) continue;
    const today = dateInTz(now, s.timezone);
    const p = zonedParts(now, s.timezone);
    const [fh, fm] = String(s.follow_up_time).split(':').map(Number);
    const followUpDue = s.last_follow_up_date !== today && (p.hour > fh || (p.hour === fh && p.minute >= fm));
    const replyDue = minutes > 0 && (!lastReplyCheck.has(ws) || now - lastReplyCheck.get(ws) >= minutes * 60000);
    if (!followUpDue && !replyDue) continue;
    running.add(ws);
    (async () => {
      try {
        if (followUpDue) await runFollowUps(ws); // includes a reply check
        else await checkReplies(ws);
        lastReplyCheck.set(ws, now);
      } catch (err) {
        console.warn(`[clientTracker] workspace ${String(ws).slice(0, 8)}: ${err.message}`);
        lastReplyCheck.set(ws, now);
      } finally {
        running.delete(ws);
      }
    })();
  }
}

function _setRetryDelayForTests(ms) { retryDelayMs = ms; }

module.exports = {
  setup,
  saveSettings: async (ws, input) => saveSettings(ws, validateSettings(input)),
  getSettings,
  status,
  importLeads,
  sendOutreach,
  checkReplies,
  runFollowUps,
  sendApproved,
  recentActivity,
  tick,
  // pure helpers, exported for tests
  pickSlots,
  classifyReply,
  stripQuoted,
  fillTemplate,
  withRetry,
  dateInTz,
  zonedToUtc,
  STAGES,
  TABS,
  TRACKER_HEADER,
  LABEL_NAME,
  OPT_OUT_LINE,
  OPT_OUT_CONFIRMATION,
  TrackerError,
  _setRetryDelayForTests,
};
