// Leads: everyone who messages on WhatsApp becomes a lead; Ian fills in what he
// learns and moves the status; hot leads alert the owner once a day; quiet
// leads get at most 2 follow-ups (8am-7pm Ghana, never Sunday, never after
// STOP / not interested / won / lost / a held reply, never to scraped leads);
// ask-first turns follow-ups into approval tasks; the daily summary; each
// workspace sees only its own leads. Nothing real is sent.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
process.env.WA_TIMEZONE = 'Africa/Accra';
delete process.env.WA_AUTO_REPLY;

const assert = require('assert');
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const notifications = require('../core/notifications');
const memory = require('../memory');
const outbox = require('../core/whatsapp/outbox');
const waStore = require('../core/whatsapp/store');
const store = require('../core/leads/store');
const leads = require('../core/leads');
const WhatsAppAgent = require('../agents/whatsapp/WhatsAppAgent');

const WS = 'aaaaaaaa-0000-0000-0000-0000000000c1';
const OTHER = 'bbbbbbbb-0000-0000-0000-0000000000c2';
const DAY = 24 * 60 * 60 * 1000;
const WED_10AM = new Date('2026-11-04T10:00:00Z'); // Accra = UTC
const SUN_10AM = new Date('2026-11-08T10:00:00Z');
const WED_9PM = new Date('2026-11-04T21:00:00Z');
const ago = (days, from = WED_10AM) => new Date(from.getTime() - days * DAY).toISOString();

let modelAnswer = '';
mockProvider.complete = async () => ({ provider: 'mock', text: modelAnswer, costEstimate: 0 });
orchestrator.approveTask = async (taskId) => ({ ...(await memory.getTask(taskId)), status: 'done' });
const ownerMsgs = [];
notifications.notifyOwner = async (a) => { ownerMsgs.push(a); return { whatsapp: 'sent' }; };
const pending = [];
notifications.notifyOwnerPendingApproval = async (a) => { pending.push(a); return {}; };
notifications.notifyOwnerFyi = async () => 'sent';
memory.getBusinessProfile = async () => ({ business_name: 'CodeCraft' });
const queued = [];
outbox.enqueue = async ({ recipients }) => { queued.push(...recipients); return { queued: recipients.length, rejected: [] }; };

const reset = () => { store._resetMemory(); ownerMsgs.length = 0; pending.length = 0; queued.length = 0; };
const quietLead = (fields = {}) => store.createLead(WS, {
  source: 'whatsapp', session_name: 'default', user_id: 'admin-1', contact_number: fields.contact_number || '233201110001',
  name: 'Kofi', need: 'website', summary: 'Kofi runs a restaurant in Accra and wants a website.',
  status: 'interested', last_inbound_at: ago(3), last_outbound_at: ago(3), last_message_at: ago(3), ...fields,
});
const settings = (over = {}) => store.saveSettings(WS, { ask_before_followup: false, ...over });

(async () => {
  // 1. Everyone who messages becomes a lead (status New), once.
  {
    reset();
    await leads.recordInbound({ workspaceId: WS, sessionName: 'default', userId: 'admin-1', contactNumber: '233201110001', contactName: 'Kofi A.' });
    await leads.recordInbound({ workspaceId: WS, sessionName: 'default', userId: 'admin-1', contactNumber: '233201110001' });
    const all = await store.listLeads(WS);
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].status, 'new');
    assert.strictEqual(all[0].contact_name, 'Kofi A.');
    assert(all[0].last_inbound_at);
    console.log('✓ a new WhatsApp contact becomes one lead (New); later messages update it');
  }

  // 2. Ian fills in what he learned (from his normal reply) and moves New -> Interested.
  {
    reset();
    await leads.recordInbound({ workspaceId: WS, sessionName: 'default', contactNumber: '233201110002' });
    const agent = new WhatsAppAgent();
    modelAnswer = JSON.stringify({
      reply: 'Good morning! We build websites for restaurants. What is the name of your restaurant?', hold: false, reason: '', sources: [], photos: [],
      lead: { name: 'Ama', business_type: 'restaurant', need: 'website', budget: null, timeline: 'unknown', location: 'Kumasi', status: 'interested', summary: 'Ama wants a website for her restaurant in Kumasi.' },
    });
    await agent.handleIncomingMessage({ from: '233201110002', body: 'Hi, I need a website for my restaurant in Kumasi', workspaceId: WS, session: 'default', userId: 'admin-1' });
    const l = await store.findByNumber(WS, '233201110002');
    assert.strictEqual(l.name, 'Ama');
    assert.strictEqual(l.need, 'website');
    assert.strictEqual(l.location, 'Kumasi');
    assert(!l.timeline, 'unknown is not saved');
    assert.strictEqual(l.status, 'interested');
    assert(/restaurant/.test(l.summary));
    assert.deepStrictEqual(leads.normalizeInfo({ need: 'E-commerce' }).need, 'ecommerce');
    assert.deepStrictEqual(leads.normalizeInfo({ need: 'online shop' }).need, 'ecommerce');
    console.log('✓ name, business, need, location and a summary come from Ian\'s reply; New -> Interested');
  }

  // 3. Not interested; the owner's Won/Lost are never overwritten by Ian.
  {
    reset();
    const a = await quietLead({ contact_number: '233201110003', status: 'interested' });
    await leads.applyFromAgent({ workspaceId: WS, contactNumber: a.contact_number, info: { status: 'not_interested' }, incoming: 'no thanks' });
    assert.strictEqual((await store.getLead(WS, a.id)).status, 'not_interested');
    const b = await quietLead({ contact_number: '233201110004', status: 'won', status_set_by: 'owner' });
    await leads.applyFromAgent({ workspaceId: WS, contactNumber: b.contact_number, info: { status: 'not_interested' }, incoming: 'ok' });
    assert.strictEqual((await store.getLead(WS, b.id)).status, 'won');
    console.log('✓ "not interested" is recorded; your Won/Lost stays');
  }

  // 4. Hot lead: price / start / deadline -> one alert per lead per day.
  {
    reset();
    const l = await quietLead({ contact_number: '233201110005', status: 'new' });
    const r1 = await leads.applyFromAgent({ workspaceId: WS, contactNumber: l.contact_number, info: {}, incoming: 'How much does a website cost?' });
    const r2 = await leads.applyFromAgent({ workspaceId: WS, contactNumber: l.contact_number, info: {}, incoming: 'and how much for the logo?' });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(r1.hot, 'asked about price');
    assert.strictEqual(r2.hot, null, 'not alerted twice in a day');
    assert.strictEqual(ownerMsgs.length, 1);
    assert(/Hot lead/.test(ownerMsgs[0].text) && /233201110005/.test(ownerMsgs[0].text));
    assert.strictEqual((await store.getLead(WS, l.id)).status, 'interested');
    const plain = await leads.applyFromAgent({ workspaceId: WS, contactNumber: '233201110005', info: {}, incoming: 'Good morning' });
    assert.strictEqual(plain.hot, null);
    console.log('✓ "how much?" alerts you once a day; a greeting does not');
  }

  // 5. A price sent to them = Quote sent.
  {
    reset();
    const l = await quietLead({ contact_number: '233201110006' });
    await leads.recordOutbound({ workspaceId: WS, contactNumber: l.contact_number, text: 'A 5-page site is GH₵ 3,500.', source: 'auto_reply' });
    assert.strictEqual((await store.getLead(WS, l.id)).status, 'quote_sent');
    const m = await quietLead({ contact_number: '233201110007' });
    await leads.recordOutbound({ workspaceId: WS, contactNumber: m.contact_number, text: 'We build websites and online shops.', source: 'auto_reply' });
    assert.strictEqual((await store.getLead(WS, m.id)).status, 'interested');
    console.log('✓ a reply with a price sets Quote sent; other replies do not');
  }

  // 6. Follow-up timing: 1st after 2 days of quiet, 2nd 5 days after their last message, max 2.
  {
    const s = { ...store.DEFAULT_SETTINGS };
    const base = { source: 'whatsapp', status: 'interested', followups_sent: 0, last_inbound_at: ago(3), last_outbound_at: ago(3) };
    const now = WED_10AM.getTime();
    assert.strictEqual(leads.followUpDue(base, s, now), true);
    assert.strictEqual(leads.followUpDue({ ...base, last_inbound_at: ago(1), last_outbound_at: ago(1) }, s, now), false, 'only 1 day quiet');
    assert.strictEqual(leads.followUpDue({ ...base, last_outbound_at: ago(4) }, s, now), false, 'they spoke last: we owe a reply, not a follow-up');
    const after1 = { ...base, followups_sent: 1, last_inbound_at: ago(4), last_outbound_at: ago(2), last_followup_at: ago(2) };
    assert.strictEqual(leads.followUpDue(after1, s, now), false, 'second: 5 days from their last message');
    assert.strictEqual(leads.followUpDue({ ...after1, last_inbound_at: ago(6) }, s, now), true);
    assert.strictEqual(leads.followUpDue({ ...after1, last_inbound_at: ago(30), followups_sent: 2 }, s, now), false, 'never a 3rd');
    assert.strictEqual(leads.followUpDue({ ...base, source: 'scraped' }, s, now), false, 'never to scraped leads');
    for (const st of ['won', 'lost', 'not_interested']) assert.strictEqual(leads.followUpDue({ ...base, status: st }, s, now), false, st);
    assert.strictEqual(leads.followUpDue({ ...base, last_inbound_at: ago(3), last_outbound_at: ago(3) }, { ...s, first_followup_days: 4 }, now), false, 'timing is a setting');
    console.log('✓ follow-ups at 2 then 5 days (editable), at most 2, never to Won/Lost/Not interested or scraped leads');
  }

  // 7. Hours: never at night, never on Sunday.
  {
    reset();
    await settings();
    await quietLead();
    modelAnswer = 'Good morning Kofi, just checking in on the restaurant website - happy to help whenever you are ready.';
    assert.strictEqual((await leads.runFollowUps(WS, SUN_10AM)).done.length, 0);
    assert.strictEqual((await leads.runFollowUps(WS, WED_9PM)).done.length, 0);
    assert.strictEqual(queued.length, 0);
    console.log('✓ no follow-ups on Sunday or after 7pm');
  }

  // 8. Sent through the paced queue, counted, never twice in a row.
  {
    reset();
    await settings();
    const l = await quietLead();
    modelAnswer = 'Good morning Kofi, just checking in on the restaurant website - happy to help whenever you are ready.';
    const r = await leads.runFollowUps(WS, WED_10AM);
    assert.strictEqual(r.done[0].status, 'queued');
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].number, l.contact_number);
    const after = await store.getLead(WS, l.id);
    assert.strictEqual(after.followups_sent, 1);
    assert.strictEqual((await leads.runFollowUps(WS, WED_10AM)).done.length, 0, 'not again straight away');
    console.log('✓ a due follow-up goes through the outreach queue (gaps + daily limit) and is counted');
  }

  // 9. Never after STOP, or while a reply waits for you.
  {
    reset();
    await settings();
    const a = await quietLead({ contact_number: '233201110011' });
    await waStore.addOptOut('default', a.contact_number);
    const b = await quietLead({ contact_number: '233201110012' });
    await new WhatsAppAgent().createApprovalTask({ instruction: 'Reply', tool: 'whatsapp.sendMessage', payload: { to: b.contact_number, body: 'held reply' }, workspaceId: WS });
    const r = await leads.runFollowUps(WS, WED_10AM);
    const why = Object.fromEntries(r.done.map((d) => [d.lead, d.reason]));
    assert.strictEqual(why[a.id], 'replied STOP');
    assert.strictEqual(why[b.id], 'a reply is waiting for your approval');
    assert.strictEqual(queued.length, 0);
    await waStore.removeOptOut('default', a.contact_number);
    console.log('✓ never to someone who replied STOP, or whose reply is waiting for you');
  }

  // 10. "Ask me before sending follow-ups" (on by default) -> an approval task, nothing sent.
  {
    reset();
    assert.strictEqual((await store.getSettings(WS)).ask_before_followup, true, 'on by default');
    const l = await quietLead({ contact_number: '233201110021' });
    modelAnswer = 'Good morning Kofi, just checking in on the restaurant website.';
    const r = await leads.runFollowUps(WS, WED_10AM);
    assert.strictEqual(r.done[0].status, 'awaiting_approval');
    assert.strictEqual(queued.length, 0);
    const task = await memory.getTask(r.done[0].taskId);
    assert.strictEqual(task.payload.to, l.contact_number);
    assert.strictEqual(task.payload.outreach, true, 'approved follow-ups still go through the paced queue');
    assert.strictEqual(pending.length, 1);
    assert.strictEqual((await store.getLead(WS, l.id)).followups_sent, 1);
    console.log('✓ with "ask me first" on, a follow-up waits on your Tasks page');
  }

  // 11. A follow-up with a price is never sent automatically.
  {
    reset();
    await settings();
    await quietLead({ contact_number: '233201110031' });
    modelAnswer = 'Good morning Kofi, our websites start at GH₵ 2,000 - shall we begin?';
    const r = await leads.runFollowUps(WS, WED_10AM);
    assert.strictEqual(r.done[0].status, 'awaiting_approval');
    assert.strictEqual(queued.length, 0);
    console.log('✓ a follow-up mentioning a price waits for you, even with "ask me first" off');
  }

  // 12. Daily summary at 7pm, once, skipped when nothing happened.
  {
    reset();
    await store.saveSettings(WS, { last_summary_on: null });
    const sevenPm = new Date('2026-11-04T19:05:00Z');
    await store.createLead(WS, { source: 'whatsapp', contact_number: '233201110041', name: 'Esi', need: 'design', last_inbound_at: sevenPm.toISOString() });
    assert.strictEqual(await leads.runDailySummary(WS, new Date('2026-11-04T15:00:00Z')), null, 'not before 7pm');
    const r = await leads.runDailySummary(WS, sevenPm);
    assert.strictEqual(r.sent, true);
    assert(/New leads: 1/.test(ownerMsgs[0].text) && /Esi/.test(ownerMsgs[0].text));
    assert.strictEqual(await leads.runDailySummary(WS, new Date('2026-11-04T20:00:00Z')), null, 'once a day');
    reset();
    const quiet = await leads.runDailySummary(WS, sevenPm);
    assert.strictEqual(quiet.sent, false);
    assert.strictEqual(ownerMsgs.length, 0);
    console.log('✓ a daily summary at 7pm (new leads, replies, follow-ups) - once, and not on a quiet day');
  }

  // 13. The Leads page: owner edits, scraped overlay (Sheet untouched), settings checks.
  {
    reset();
    const l = await quietLead();
    const saved = await leads.updateByOwner(WS, l.id, { status: 'won', notes: 'Paid deposit' });
    assert.strictEqual(saved.status, 'won');
    assert.strictEqual(saved.status_set_by, 'owner');
    await assert.rejects(() => leads.updateByOwner(WS, l.id, { status: 'maybe' }), /Status must be/);
    const s = await leads.updateByOwner(WS, 'scraped:info@shop.com', { status: 'interested', notes: 'Called them' });
    assert.strictEqual(s.id, 'scraped:info@shop.com');
    const overlay = await store.findScraped(WS, 'info@shop.com');
    assert.strictEqual(overlay.notes, 'Called them');
    assert.strictEqual(leads.followUpDue(overlay, store.DEFAULT_SETTINGS, Date.now()), false);
    assert.throws(() => leads.validateSettings({ first_followup_days: 5, second_followup_days: 3 }), /after the first/);
    assert.throws(() => leads.validateSettings({ first_followup_days: 0 }), /whole number/);
    assert.deepStrictEqual(leads.validateSettings({ first_followup_days: 3, second_followup_days: 7, ask_before_followup: 0 }),
      { first_followup_days: 3, second_followup_days: 7, ask_before_followup: false });
    const page = await leads.listForPage(WS);
    assert(page.leads.some((x) => x.source === 'whatsapp' && x.notes === 'Paid deposit'));
    console.log('✓ you can change any lead; scraped-lead notes are saved in the app (the Sheet is not changed)');
  }

  // 14. Each workspace sees only its own leads.
  {
    reset();
    await quietLead();
    await leads.recordInbound({ workspaceId: OTHER, contactNumber: '233201110001' });
    assert.strictEqual((await store.listLeads(OTHER)).length, 1);
    assert.strictEqual((await store.listLeads(WS)).length, 1);
    await leads.updateByOwner(OTHER, (await store.listLeads(OTHER))[0].id, { notes: 'other' });
    assert(!(await store.listLeads(WS))[0].notes);
    const wsLeadId = (await store.listLeads(WS))[0].id;
    await assert.rejects(() => leads.updateByOwner(OTHER, wsLeadId, { notes: 'x' }), /not found/);
    console.log('✓ each workspace has its own leads');
  }

  console.log('\nAll leads tests passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
