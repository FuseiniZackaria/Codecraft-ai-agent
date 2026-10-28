// Client tracker (Gmail + Sheets + Calendar via Composio). Composio and the
// AI provider are stubbed with an in-memory fake Google - no real calls.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';
process.env.GOOGLE_SERVICE_ACCOUNT_FILE = '';
process.env.LEADS_SHEET_ID = '';

const assert = require('assert');

const WS = 'cccccccc-0000-0000-0000-0000000000c1';
const ME = 'owner@mybiz.com';

// ---- fake Google -----------------------------------------------------------
const tabs = { Leads: [] };
const threads = new Map(); // threadId -> [{ messageId, sender, messageText, internalDate }]
const calls = [];
let clock = Date.now();
let nextId = 1;
let createdEvents = [];
let failNext = null; // { slug, errors: [Error...] }

function parseRange(range) {
  const m = range.match(/^'((?:[^']|'')+)'!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
  const tab = m[1].replace(/''/g, "'");
  const col = (c) => c.charCodeAt(0) - 65;
  return { tab, c1: col(m[2]), r1: m[3] ? Number(m[3]) : 1, c2: m[4] ? col(m[4]) : col(m[2]), r2: m[5] ? Number(m[5]) : null };
}

function addMessage(threadId, sender, messageText) {
  const id = `m${nextId++}`;
  clock += 60000;
  if (!threads.has(threadId)) threads.set(threadId, []);
  threads.get(threadId).push({ messageId: id, threadId, sender, messageText, internalDate: String(clock) });
  return id;
}

async function fakeExecute(slug, args, toolkit, opts) {
  calls.push({ slug, args, toolkit, ws: opts.workspaceId });
  assert.strictEqual(opts.workspaceId, WS, 'every call runs as the workspace');
  if (failNext && failNext.slug === slug && failNext.errors.length) throw failNext.errors.shift();
  switch (slug) {
    case 'GOOGLESHEETS_GET_SPREADSHEET_INFO':
      return { response_data: { properties: { title: 'CodeCraft' }, sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) } };
    case 'GOOGLESHEETS_ADD_SHEET':
      tabs[args.title] = tabs[args.title] || [];
      return {};
    case 'GOOGLESHEETS_VALUES_GET': {
      const r = parseRange(args.range);
      const rows = tabs[r.tab] || [];
      const end = r.r2 || rows.length;
      return { response_data: { values: rows.slice(r.r1 - 1, end).map((row) => row.slice(r.c1, r.c2 + 1)) } };
    }
    case 'GOOGLESHEETS_VALUES_UPDATE': {
      const r = parseRange(args.range);
      args.values.forEach((row, i) => { tabs[r.tab][r.r1 - 1 + i] = row.slice(); });
      return {};
    }
    case 'GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND': {
      const r = parseRange(args.range);
      tabs[r.tab].push(...args.values.map((v) => v.slice()));
      return {};
    }
    case 'GMAIL_LIST_LABELS': return { labels: [{ id: 'INBOX', name: 'INBOX' }] };
    case 'GMAIL_CREATE_LABEL': return { id: 'Label_77', name: args.label_name };
    case 'GMAIL_GET_PROFILE': return { emailAddress: ME };
    case 'GMAIL_SEND_EMAIL': {
      const threadId = `t${nextId++}`;
      const id = addMessage(threadId, `Me <${ME}>`, args.body);
      return { data: { id, threadId } };
    }
    case 'GMAIL_REPLY_TO_THREAD': {
      const id = addMessage(args.thread_id, `Me <${ME}>`, args.message_body);
      return { data: { id, threadId: args.thread_id } };
    }
    case 'GMAIL_ADD_LABEL_TO_EMAIL': {
      for (const msgs of threads.values()) for (const m of msgs) if (m.messageId === args.message_id) m.labelled = true;
      return {};
    }
    case 'GMAIL_LIST_THREADS': {
      assert.ok(args.query.includes('label:"CodeCraft Outreach"'), 'thread listing is constrained to the label');
      return { threads: [...threads.entries()].filter(([, ms]) => ms.some((m) => m.labelled)).map(([id]) => ({ id })) };
    }
    case 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID': return { messages: threads.get(args.thread_id) || [] };
    case 'GOOGLECALENDAR_FREE_BUSY_QUERY': return { calendars: { primary: { busy: [] } } };
    case 'GOOGLECALENDAR_CREATE_EVENT':
      createdEvents.push(args);
      return { response_data: { htmlLink: 'https://calendar.google.com/event?eid=abc', hangoutLink: 'https://meet.google.com/abc-defg-hij' } };
    default:
      throw new Error(`unexpected ${slug}`);
  }
}

// AI: decides from keywords in the reply, like a real classifier would.
const fakeProvider = {
  async complete({ system, prompt }) {
    if (/option number/.test(system)) return { text: JSON.stringify({ choice: /second/i.test(prompt) ? 2 : null }) };
    if (/interested|sounds good/i.test(prompt.split('Reply:')[1])) return { text: '{"intent":"interested"}' };
    if (/pause|stop for now/i.test(prompt)) return { text: '{"intent":"unclear_opt_out"}' };
    if (/no thanks/i.test(prompt)) return { text: '{"intent":"not_interested"}' };
    return { text: '{"intent":"question"}' };
  },
};

const tab = (name) => tabs[name];
const row = (email) => tabs['Client Tracker'].find((r) => r[1] === email);
const col = (name) => require('../core/clientTracker').TRACKER_HEADER.indexOf(name);

async function main() {
  require('../core/workspaceContext').getAppOwnerWorkspaceId = async () => null;
  require('../core/router').selectProvider = () => fakeProvider;
  const composio = require('../core/composio');
  composio.execute = fakeExecute;
  const connections = require('../core/workspaceConnections');
  const memory = require('../memory');
  require('../core/googleSheets')._resetForTests();
  const ct = require('../core/clientTracker');
  ct._setRetryDelayForTests(0);

  // --- pure helpers --------------------------------------------------------
  {
    const now = new Date('2026-11-02T08:00:00Z'); // Monday, Accra = UTC
    const slots = ct.pickSlots([{ start: '2026-11-02T10:00:00Z', end: '2026-11-02T17:00:00Z' }], { now, timeZone: 'Africa/Accra' });
    assert.strictEqual(slots.length, 3);
    assert.ok(slots.every((s) => !s.startsWith('2026-11-02')), 'busy Monday afternoon is skipped');
    assert.deepStrictEqual(slots.map((s) => s.slice(11, 16)), ['09:00', '09:00', '09:00'], 'working hours, one per day');
    const fri = ct.pickSlots([], { now: new Date('2026-11-06T16:00:00Z'), timeZone: 'UTC' });
    assert.ok(fri.every((s) => ![0, 6].includes(new Date(s).getUTCDay())), 'no weekend slots');
    const ny = ct.pickSlots([], { now: new Date('2026-11-02T00:00:00Z'), timeZone: 'America/New_York' });
    assert.strictEqual(ny[0], '2026-11-02T14:00:00.000Z', '09:00 New York = 14:00 UTC');
    console.log('✓ pickSlots: free/busy, working hours, weekdays, timezone');

    assert.strictEqual(await ct.classifyReply('Please unsubscribe me'), 'opt_out');
    assert.strictEqual(await ct.classifyReply('STOP'), 'opt_out');
    assert.strictEqual(await ct.classifyReply('stop for now?'), 'unclear_opt_out');
    assert.strictEqual(await ct.classifyReply('sounds good\n\nOn Mon, X wrote:\n> please remove me'), 'interested', 'quoted text ignored');
    console.log('✓ classifyReply: clear opt-outs never depend on the AI; quoted text ignored');

    let n = 0;
    assert.strictEqual(await ct.withRetry(async () => { if (++n < 3) throw new Error('503 backend error'); return 'ok'; }), 'ok');
    n = 0;
    await assert.rejects(ct.withRetry(async () => { n++; throw new Error('500 internal error'); }, { isSend: true }));
    assert.strictEqual(n, 1, 'a send is not retried after a 5xx (could double-send)');
    n = 0;
    assert.strictEqual(await ct.withRetry(async () => { if (++n < 2) throw new Error('429 rate limit'); return 'ok'; }, { isSend: true }), 'ok');
    console.log('✓ retries: transient errors retried; sends only on rate limits');
  }

  // --- setup ---------------------------------------------------------------
  await assert.rejects(ct.setup(WS), /not connected|Connect/);
  await connections.upsertConnection(WS, 'googlesheets', {
    composio_account_id: 'ca_s', status: 'connected', provider_meta: { sheet_id: 'sheet_abcdefghijklmnopqrstuv' },
  });
  await connections.upsertConnection(WS, 'gmail', { composio_account_id: 'ca_g', status: 'connected' });
  await ct.setup(WS, { daily_cap: 4, timezone: 'UTC' });
  assert.deepStrictEqual(tab('Client Tracker')[0].slice(0, 8), ['Name', 'Email', 'Company', 'Stage', 'Last Contact Date', 'Next Follow-up Date', 'Calendar Event Link', 'Notes']);
  assert.deepStrictEqual(tab('Activity Log')[0], ['Timestamp', 'Lead Email', 'Action', 'Result', 'Details']);
  assert.deepStrictEqual(tab('Do Not Contact')[0], ['Email', 'Date Added', 'Reason']);
  const settings = await ct.getSettings(WS);
  assert.strictEqual(settings.label_id, 'Label_77');
  assert.strictEqual(settings.my_email, ME);
  await assert.rejects(ct.saveSettings(WS, { daily_cap: 0 }), /Daily email cap/);
  console.log('✓ setup: three tabs + headers, "CodeCraft Outreach" label, settings validated');

  // --- import (Do Not Contact is always checked) ----------------------------
  tab('Do Not Contact').push(['blocked@x.com', '2026-01-01', 'Opted out by reply']);
  const imp = await ct.importLeads(WS, [
    { name: 'Ama Owusu', email: 'ama@a.com', company: 'A Ltd' },
    { name: 'Kofi Mensah', email: 'kofi@b.com' },
    { name: 'Efua Boateng', email: 'efua@c.com' },
    { name: 'Yaw Darko', email: 'yaw@d.com' },
    { name: 'Big Client', email: 'vip@e.com', highValue: true },
    { name: 'Blocked', email: 'Blocked@X.com' },
    { name: 'Dup', email: 'ama@a.com' },
    { name: 'Bad', email: 'nope' },
  ]);
  assert.strictEqual(imp.added, 5);
  assert.deepStrictEqual(imp.skipped.map((s) => s.reason), ['on Do Not Contact list', 'already in tracker', 'invalid email']);
  assert.ok(!row('blocked@x.com'), 'Do Not Contact address never re-added');
  assert.ok(tab('Activity Log').some((r) => r[2] === 'import_blocked' && r[1] === 'blocked@x.com'));
  console.log('✓ import: Do Not Contact never re-added, duplicates and bad emails skipped');

  // --- outreach: cap, high-value approval, label, opt-out line --------------
  const out = await ct.sendOutreach(WS, { subject: 'Hi {{first_name}}', body: 'Hello {{first_name}} at {{company}}, quick idea for you.' });
  assert.strictEqual(out.sent, 4, 'cap of 4 reached');
  assert.strictEqual(out.pendingApproval, 1, 'high-value lead waits for approval');
  const sends = calls.filter((c) => c.slug === 'GMAIL_SEND_EMAIL');
  assert.strictEqual(sends.length, 4);
  assert.ok(sends.every((c) => c.args.body.endsWith(ct.OPT_OUT_LINE)), 'every email ends with the opt-out line');
  assert.strictEqual(sends[0].args.subject, 'Hi Ama');
  assert.ok(sends[0].args.body.includes('Hello Ama at A Ltd'));
  assert.ok(!sends.some((c) => c.args.recipient_email === 'vip@e.com'));
  assert.strictEqual(calls.filter((c) => c.slug === 'GMAIL_ADD_LABEL_TO_EMAIL').length, 4, 'every sent email labelled');
  const ama = row('ama@a.com');
  assert.strictEqual(ama[col('Stage')], 'Contacted');
  assert.strictEqual(ama[col('Last Contact Date')], ct.dateInTz(new Date(), 'UTC'));
  assert.ok(ama[col('Next Follow-up Date')] > ama[col('Last Contact Date')]);
  assert.strictEqual(row('vip@e.com')[col('Automation')], 'awaiting approval');
  const tasks = (await memory.listTasks({ workspaceId: WS })).filter((t) => t.status === 'pending_approval');
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].toolCall.tool, 'clienttracker.sendApproved');
  const blocked = await ct.sendOutreach(WS, { subject: 's', body: 'b' });
  assert.strictEqual(blocked.sent, 0, 'nothing left to send today');
  console.log('✓ outreach: Contacted + date, labelled, opt-out line, daily cap, high-value needs approval');

  // Approval sends it (cap raised so it's allowed today).
  await ct.saveSettings(WS, { daily_cap: 50 });
  const action = require('../plugins/clienttracker/actions/sendApproved');
  await assert.rejects(action.run(tasks[0].payload, { workspaceId: WS }), /approved task/);
  const approved = await action.run(tasks[0].payload, { workspaceId: WS, approvedTaskId: tasks[0].id });
  assert.strictEqual(approved.status, 'sent');
  assert.strictEqual(row('vip@e.com')[col('Stage')], 'Contacted');
  console.log('✓ approval: only the approval flow can send to a high-value lead');

  // --- replies --------------------------------------------------------------
  const thread = (email) => row(email)[col('Thread ID')];
  addMessage(thread('ama@a.com'), 'Ama <ama@a.com>', 'Please stop emailing me.');
  addMessage(thread('kofi@b.com'), 'Kofi <kofi@b.com>', 'Yes, interested - tell me more');
  addMessage(thread('efua@c.com'), 'Efua Personal <efua.personal@gmail.com>', 'Hi, this is Efua from my other address');
  addMessage(thread('yaw@d.com'), `Me <${ME}>`, 'Hey Yaw, replying myself on this one.');
  addMessage('t_personal', 'Friend <friend@x.com>', 'Dinner tonight?'); // not labelled, not tracked
  const r1 = await ct.checkReplies(WS);
  assert.ok(!calls.some((c) => c.slug === 'GMAIL_FETCH_EMAILS'), 'never scans the inbox');
  assert.ok(!calls.some((c) => c.slug === 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID' && c.args.thread_id === 't_personal'), 'untracked thread never opened');
  assert.deepStrictEqual(r1.handled.map((h) => h.outcome).sort(), ['interested', 'manual_handling', 'opt_out', 'possible_match']);

  assert.strictEqual(row('ama@a.com')[col('Stage')], 'Do Not Contact');
  assert.strictEqual(row('ama@a.com')[col('Next Follow-up Date')], '', 'follow-ups cancelled');
  assert.ok(tab('Do Not Contact').some((r) => r[0] === 'ama@a.com'));
  const confirm = calls.filter((c) => c.slug === 'GMAIL_REPLY_TO_THREAD' && c.args.recipient_email === 'ama@a.com');
  assert.strictEqual(confirm.length, 1);
  assert.strictEqual(confirm[0].args.message_body, ct.OPT_OUT_CONFIRMATION);

  assert.strictEqual(row('kofi@b.com')[col('Stage')], 'Replied');
  const slotsMsg = calls.filter((c) => c.slug === 'GMAIL_REPLY_TO_THREAD' && c.args.recipient_email === 'kofi@b.com').pop();
  assert.ok(/1\. .*\n2\. .*\n3\. /.test(slotsMsg.args.message_body), 'three options emailed');
  assert.strictEqual(row('kofi@b.com')[col('Proposed Slots')].split('|').length, 3);

  assert.ok(row('efua@c.com')[col('Notes')].includes('Possible match, needs review'));
  assert.strictEqual(row('efua@c.com')[col('Automation')], 'paused');
  assert.strictEqual(row('efua@c.com')[col('Stage')], 'Contacted', 'not guessed as a reply');

  assert.strictEqual(row('yaw@d.com')[col('Stage')], 'Manual Handling');
  assert.ok(!JSON.stringify(tabs).includes('Dinner tonight'), 'nothing from untracked mail stored');
  assert.ok(!JSON.stringify(tab('Activity Log')).includes('tell me more'), 'reply text not logged');
  console.log('✓ replies: opt-out -> DNC + one confirmation; interested -> 3 slots; other address flagged; manual reply pauses');

  // Booking: Kofi picks the second option.
  addMessage(thread('kofi@b.com'), 'Kofi <kofi@b.com>', 'The second one works for me');
  await ct.checkReplies(WS);
  assert.strictEqual(createdEvents.length, 1);
  assert.strictEqual(createdEvents[0].create_meeting_room, true, 'Google Meet link requested');
  assert.deepStrictEqual(createdEvents[0].attendees, ['kofi@b.com']);
  assert.strictEqual(row('kofi@b.com')[col('Stage')], 'Booked');
  assert.strictEqual(row('kofi@b.com')[col('Calendar Event Link')], 'https://calendar.google.com/event?eid=abc');
  console.log('✓ booking: confirmed slot -> event with Meet + invite, Stage Booked + link');

  // Ambiguous opt-out -> Needs Review, and no more sends.
  addMessage(thread('vip@e.com'), 'Big <vip@e.com>', 'Can we pause, stop for now?');
  await ct.checkReplies(WS);
  assert.strictEqual(row('vip@e.com')[col('Stage')], 'Needs Review');
  assert.strictEqual(row('vip@e.com')[col('Automation')], 'paused');
  console.log('✓ unclear opt-out -> Needs Review, automation paused');

  // --- follow-ups -----------------------------------------------------------
  await ct.importLeads(WS, [{ name: 'Abena Asante', email: 'abena@f.com' }]);
  await ct.sendOutreach(WS, { subject: 'Hi', body: 'Hello' });
  const past = '2020-01-01';
  const bump = () => { row('abena@f.com')[col('Next Follow-up Date')] = past; };
  bump();
  let f = await ct.runFollowUps(WS);
  assert.strictEqual(f.sent, 1);
  assert.strictEqual(row('abena@f.com')[col('Stage')], 'Follow-up Sent');
  assert.strictEqual(row('abena@f.com')[col('Follow-ups Sent')], '1');
  bump();
  f = await ct.runFollowUps(WS);
  assert.strictEqual(f.sent, 1);
  assert.strictEqual(row('abena@f.com')[col('Next Follow-up Date')], '', 'no third follow-up scheduled');
  bump();
  f = await ct.runFollowUps(WS);
  assert.strictEqual(f.sent, 0, 'stops after 2 follow-ups');
  // Someone on DNC by hand never gets a follow-up.
  row('efua@c.com')[col('Automation')] = '';
  row('efua@c.com')[col('Next Follow-up Date')] = past;
  tab('Do Not Contact').push(['efua@c.com', past, 'added by hand']);
  f = await ct.runFollowUps(WS);
  assert.strictEqual(f.blocked, 1);
  assert.ok(tab('Activity Log').some((r) => r[1] === 'efua@c.com' && r[2] === 'followup_blocked'));
  console.log('✓ follow-ups: 3-day rule, Follow-up Sent, max 2, Do Not Contact blocks the send');

  // Every action is in the Activity Log.
  const actions = new Set(tab('Activity Log').slice(1).map((r) => r[2]));
  for (const a of ['tracker_setup', 'leads_imported', 'email_sent', 'outreach_blocked', 'outreach_approval_requested', 'opt_out', 'reply_classified', 'possible_match', 'manual_reply_detected', 'meeting_booked']) {
    assert.ok(actions.has(a), `activity log has ${a}`);
  }
  console.log('✓ activity log covers every action');
}

main().then(() => console.log('client-tracker tests passed')).catch((err) => { console.error(err); process.exit(1); });
