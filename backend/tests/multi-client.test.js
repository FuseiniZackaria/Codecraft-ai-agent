// Multi-client WhatsApp: many businesses, each with its own number, settings
// and alerts - and nothing ever crossing between them. Covers: no sending from
// another business's number (no "any working session" fallback); the daily
// auto-reply limit per number; reply-only (Tier 1) numbers never message
// first, even when approved; warm-up limits for new numbers; copy-paste
// messages refused; Meta numbers: 24-hour rule, templates, opt-ins, their own
// credentials; alerts go to the right business; a lost/banned number alerts
// once; town and language per business. Nothing real is sent.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
process.env.WAHA_MULTI_SESSION = 'true';
delete process.env.WA_AUTO_REPLY;
delete process.env.WA_ALERT_SESSION;

const assert = require('assert');
const config = require('../config');
config.waha.multiSession = true;
config.waha.baseUrl = config.waha.baseUrl || 'http://waha.test';
config.waha.apiKey = config.waha.apiKey || 'test-key';
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const memory = require('../memory');
const store = require('../core/whatsapp/store');
const clientSettings = require('../core/whatsapp/clientSettings');
const messaging = require('../core/whatsapp/messaging');
const outbox = require('../core/whatsapp/outbox');
const whatsappProvider = require('../core/whatsappProvider');
const { getProviderForSession } = require('../core/whatsapp');
const MetaCloudProvider = require('../core/whatsapp/MetaCloudProvider');
const notifications = require('../core/notifications');
const telegramProvider = require('../core/telegramProvider');
const WhatsAppAgent = require('../agents/whatsapp/WhatsAppAgent');

const YOU = 'aaaaaaaa-0000-0000-0000-00000000aa01'; // the app owner's workspace
const RESTAURANT = 'bbbbbbbb-0000-0000-0000-00000000bb02'; // a Tier 1 client
const SHOP = 'cccccccc-0000-0000-0000-00000000cc03'; // a Meta (Tier 2) client
const NO_NUMBER = 'dddddddd-0000-0000-0000-00000000dd04'; // a client that hasn't linked WhatsApp
clientSettings.testing.operatorWorkspaceId = YOU;

const S_YOU = 'admin_you';
const S_REST = 'admin_restaurant';
const S_SHOP = MetaCloudProvider.sessionNameFor('1098765');
const DAY = 24 * 60 * 60 * 1000;

let lastPrompt = null;
mockProvider.complete = async (req) => { lastPrompt = req; return { provider: 'mock', text: JSON.stringify({ reply: 'Good evening! How can I help you today?', hold: false, reason: '' }), costEstimate: 0 }; };
const approved = [];
orchestrator.approveTask = async (taskId) => { const t = await memory.getTask(taskId); approved.push(t.payload); return { ...t, status: 'done' }; };

let n = 0;
const incoming = (session, ws, contactNumber, text = 'hello', at = new Date().toISOString()) => store.saveMessage({
  provider: session.startsWith('meta_') ? 'meta' : 'waha', sessionName: session, userId: null, workspaceId: ws, direction: 'in',
  contactNumber, text, waMessageId: `in-${++n}`, timestamp: at,
});
const autoReply = (session, ws, contactNumber) => store.saveMessage({
  provider: 'waha', sessionName: session, userId: null, workspaceId: ws, direction: 'out', contactNumber, text: 'reply', waMessageId: `out-${++n}`, source: 'auto_reply',
});

(async () => {
  await store.upsertSession({ session_name: S_YOU, user_id: 'u-you', workspace_id: YOU, status: 'WORKING', phone_number: '233500000001' });
  await store.upsertSession({ session_name: S_REST, user_id: 'u-rest', workspace_id: RESTAURANT, status: 'WORKING', phone_number: '233500000002' });
  await store.upsertSession({ session_name: S_SHOP, user_id: 'u-shop', workspace_id: SHOP, status: 'WORKING', phone_number: '233500000003' });

  // 1. Never from another business's number.
  {
    await assert.rejects(whatsappProvider.sendMessage('233241000001', 'hi', { workspaceId: NO_NUMBER }), /no WhatsApp number linked/i,
      'a business without a number gets an error - not someone else\'s WhatsApp');
    assert.strictEqual(await whatsappProvider.pickSession({ workspaceId: RESTAURANT }, 'waha'), S_REST);
    assert.strictEqual(await whatsappProvider.pickSession({}, 'waha'), S_YOU, 'your own alerts go from YOUR number');
    await assert.rejects(
      messaging.assertSendAllowed({ provider: { name: 'waha' }, sessionName: S_REST, contactNumber: '233241000001', workspaceId: SHOP, source: 'manual' }),
      (e) => e.code === 'WRONG_BUSINESS',
    );
    console.log("✓ a message only ever goes out from its own business's number (no 'any working session' fallback)");
  }

  // 2. Reply-only (Tier 1): clients start reply-only; never a first message, even approved; replies are fine.
  {
    assert.strictEqual((await clientSettings.get(RESTAURANT)).tier, 'reply_only', 'a client starts reply-only');
    assert.strictEqual((await clientSettings.get(YOU)).tier, 'outreach', 'your own workspace keeps outreach');
    await assert.rejects(
      messaging.assertSendAllowed({ provider: { name: 'waha' }, sessionName: S_REST, contactNumber: '233241000099', workspaceId: RESTAURANT, source: 'manual' }),
      (e) => e.code === 'REPLY_ONLY',
    );
    await incoming(S_REST, RESTAURANT, '233241000010');
    assert.strictEqual(await messaging.assertSendAllowed({ provider: { name: 'waha' }, sessionName: S_REST, contactNumber: '233241000010', workspaceId: RESTAURANT, source: 'auto_reply' }), RESTAURANT);
    const q = await outbox.enqueue({ sessionName: S_REST, userId: 'u-rest', workspaceId: RESTAURANT, allowFirstContact: true,
      recipients: [{ number: '233241000099', text: 'Our new menu is out' }] });
    assert.strictEqual(q.queued, 0);
    assert(/reply-only/.test(q.rejected[0].reason), 'approval does not unlock cold outreach on a Tier 1 number');
    console.log('✓ reply-only numbers: replies yes; first messages no - even approved or typed by hand');
  }

  // 3. Daily auto-reply limit is per number: the restaurant hitting it doesn't stop your replies.
  {
    await clientSettings.save(RESTAURANT, { daily_reply_limit: 3 });
    for (let i = 0; i < 3; i++) await autoReply(S_REST, RESTAURANT, `23324100002${i}`);
    const agent = new WhatsAppAgent();
    await incoming(S_REST, RESTAURANT, '233241000030', 'are you open?');
    const r = await agent.handleIncomingMessage({ from: '233241000030', body: 'are you open?', workspaceId: RESTAURANT, session: S_REST, userId: 'u-rest' });
    assert.strictEqual(r.held, true);
    assert(/daily auto-reply limit \(3\)/.test(r.reason), r.reason);
    await incoming(S_YOU, YOU, '233241000031', 'are you open?');
    const mine = await agent.handleIncomingMessage({ from: '233241000031', body: 'are you open?', workspaceId: YOU, session: S_YOU, userId: 'u-you' });
    assert.strictEqual(mine.held, false, `your number keeps replying: ${mine.reason}`);
    console.log("✓ the daily auto-reply limit is per number: one busy client never stops another's replies");
  }

  // 4. Town and language per business reach Ian's instructions.
  {
    await clientSettings.save(RESTAURANT, { place: 'Kumasi', language: 'english', daily_reply_limit: 100 });
    const agent = new WhatsAppAgent();
    await agent.handleIncomingMessage({ from: '233241000030', body: 'hi', workspaceId: RESTAURANT, session: S_REST, userId: 'u-rest' });
    assert(lastPrompt.system.includes('(Kumasi)'), 'the business\'s own town');
    assert(lastPrompt.system.includes(clientSettings.LANGUAGE_RULES.english));
    await clientSettings.save(RESTAURANT, { language: 'local' });
    await agent.handleIncomingMessage({ from: '233241000030', body: 'Ɛte sɛn', workspaceId: RESTAURANT, session: S_REST, userId: 'u-rest' });
    assert(lastPrompt.system.includes(clientSettings.LANGUAGE_RULES.local));
    // Auto-reply switched off for one business only.
    await clientSettings.save(RESTAURANT, { auto_reply: false });
    const off = await agent.handleIncomingMessage({ from: '233241000030', body: 'hello?', workspaceId: RESTAURANT, session: S_REST, userId: 'u-rest' });
    assert.strictEqual(off.reason, 'auto-reply is off');
    await clientSettings.save(RESTAURANT, { auto_reply: true });
    console.log('✓ each business has its own town, language (English / match / local) and auto-reply switch');
  }

  // 5. Conversation history is read per number: the restaurant's chat with a contact never leaks into yours.
  {
    await incoming(S_REST, RESTAURANT, '233241000050', 'secret restaurant order');
    await incoming(S_YOU, YOU, '233241000050', 'hi Ian');
    const mine = await store.listSessionMessages(S_YOU, '233241000050');
    assert(mine.every((m) => m.session_name === S_YOU) && !mine.some((m) => /secret/.test(m.body)));
    // A message with no admin attached is never "visible" to a viewer with no id.
    assert.strictEqual((await store.listConversations({ userId: null, workspaceId: YOU })).length, 0);
    console.log("✓ Ian reads only this number's conversation; empty ids never match other businesses' messages");
  }

  // 6. Warm-up: a newly linked number ramps up 5 -> 10 -> 15 -> the full limit.
  {
    const s = await clientSettings.get(RESTAURANT);
    const at = (days) => ({ linked_at: new Date(Date.now() - days * DAY).toISOString() });
    assert.strictEqual(clientSettings.outreachLimitFor(at(0), s).limit, Math.min(5, config.whatsapp.dailyLimit));
    assert.strictEqual(clientSettings.outreachLimitFor(at(4), s).limit, Math.min(10, config.whatsapp.dailyLimit));
    assert.strictEqual(clientSettings.outreachLimitFor(at(8), s).limit, Math.min(15, config.whatsapp.dailyLimit));
    assert.strictEqual(clientSettings.outreachLimitFor(at(20), s).limit, config.whatsapp.dailyLimit);
    assert.strictEqual(clientSettings.outreachLimitFor({ linked_at: null }, s).warmingUp, false, 'numbers linked before this change are not throttled');
    assert.strictEqual((await clientSettings.get(YOU)).warmup_days, 0, 'your own number does not warm up');
    // Linking a number starts it; a reconnect of the same number does not restart it.
    await store.upsertSession({ session_name: 'admin_new', user_id: 'u-new', workspace_id: NO_NUMBER, status: 'SCAN_QR_CODE' });
    await messaging.handleSessionStatus({ sessionName: 'admin_new', status: 'WORKING', phoneNumber: '233500000009' });
    const linked = (await store.getSessionByName('admin_new')).linked_at;
    assert(linked, 'warm-up starts when it is linked');
    await messaging.handleSessionStatus({ sessionName: 'admin_new', status: 'WORKING', phoneNumber: '233500000009' });
    assert.strictEqual((await store.getSessionByName('admin_new')).linked_at, linked);
    console.log('✓ warm-up: new numbers send 5, then 10, then 15 a day before the full limit');
  }

  // 7. Copy-paste messages: at most 3 near-identical ones per number per day.
  {
    const people = ['233241000061', '233241000062', '233241000063', '233241000064', '233241000065'];
    for (const p of people) await incoming(S_YOU, YOU, p);
    const q = await outbox.enqueue({ sessionName: S_YOU, userId: 'u-you', workspaceId: YOU,
      recipients: people.map((p, i) => ({ number: p, text: `Hi friend ${i}, we build websites for restaurants in Accra. Want a free demo?` })) });
    assert.strictEqual(q.queued, 3);
    assert(q.rejected.every((r) => /almost the same/.test(r.reason)));
    assert(outbox.similarity('Hi Ama, your order is ready', 'Kofi, the new menu is out') < 0.3);
    console.log('✓ copy-paste outreach: the 4th near-identical message from one number is refused');
  }

  // 8. Meta (Tier 2): its own credentials, the 24-hour rule, templates, opt-ins.
  {
    assert.strictEqual(getProviderForSession(S_SHOP).name, 'meta');
    assert.strictEqual(getProviderForSession(S_REST).name, 'waha');
    await clientSettings.save(SHOP, { tier: 'outreach', channel: 'meta' });
    const meta = { name: 'meta' };
    await assert.rejects(
      messaging.assertSendAllowed({ provider: meta, sessionName: S_SHOP, contactNumber: '233241000070', workspaceId: SHOP, source: 'outreach' }),
      (e) => e.code === 'META_TEMPLATE_REQUIRED',
    );
    await incoming(S_SHOP, SHOP, '233241000071', 'price?', new Date(Date.now() - 2 * DAY).toISOString());
    await assert.rejects(
      messaging.assertSendAllowed({ provider: meta, sessionName: S_SHOP, contactNumber: '233241000071', workspaceId: SHOP, source: 'manual' }),
      (e) => e.code === 'META_TEMPLATE_REQUIRED', 'older than 24 hours: template only',
    );
    await incoming(S_SHOP, SHOP, '233241000072', 'hi');
    await messaging.assertSendAllowed({ provider: meta, sessionName: S_SHOP, contactNumber: '233241000072', workspaceId: SHOP, source: 'manual' });
    // Opt-ins: an approved outreach to a stranger is refused until they've opted in.
    let q = await outbox.enqueue({ sessionName: S_SHOP, userId: 'u-shop', workspaceId: SHOP, allowFirstContact: true,
      recipients: [{ number: '233241000080', text: 'x', template: { name: 'new_stock', language: 'en', params: ['Ama'] } }] });
    assert.strictEqual(q.queued, 0);
    assert(/opted in/.test(q.rejected[0].reason));
    await store.addConsent(SHOP, ['233241000080'], { source: 'import' });
    q = await outbox.enqueue({ sessionName: S_SHOP, userId: 'u-shop', workspaceId: SHOP,
      recipients: [{ number: '233241000080', text: 'New stock, Ama!', template: { name: 'new_stock', language: 'en', params: ['Ama'] } }] });
    assert.strictEqual(q.queued, 1);
    q = await outbox.enqueue({ sessionName: S_REST, userId: 'u-rest', workspaceId: RESTAURANT,
      recipients: [{ number: '233241000010', text: 'x', template: { name: 'new_stock' } }] });
    assert(/only for Meta/.test(q.rejected[0].reason), 'no templates on a WAHA number');
    // A Meta number without the business's own Meta connection can't borrow anyone's credentials.
    await assert.rejects(MetaCloudProvider.credentialsFor(S_SHOP), /not connected for this business/);
    // Webhook: the number a message arrived on is reported, so other businesses' messages are dropped.
    const parsed = MetaCloudProvider.handleIncomingWebhook({ body: { entry: [{ changes: [{ value: { metadata: { phone_number_id: '555' }, messages: [{ id: 'wamid.1', from: '233241000090', type: 'text', text: { body: 'hi' } }] } }] }] } });
    assert.strictEqual(parsed.phoneNumberIds['wamid.1'], '555');
    console.log("✓ Meta numbers: own credentials, free text only within 24 hours, templates, outreach only to opted-in contacts");
  }

  // 9. Alerts go to the right business: a client's to ITS alert number from ITS number; yours to you.
  {
    config.waha.baseUrl = config.waha.baseUrl || 'http://waha.test';
    config.waha.apiKey = config.waha.apiKey || 'test-key';
    config.notifications.ownerWhatsappNumber = '233209999999';
    config.notifications.ownerTelegramChatId = '42';
    config.telegram.botToken = 'test-bot';
    const wa = [];
    const tg = [];
    const realWa = whatsappProvider.sendMessage;
    const realTg = telegramProvider.sendMessage;
    whatsappProvider.sendMessage = async (to, text, opts) => { wa.push({ to, opts }); return {}; };
    telegramProvider.sendMessage = async (chat, text) => { tg.push({ chat, text }); return {}; };

    await clientSettings.save(RESTAURANT, clientSettings.validate({ alert_number: '0244111222' }).patch); // as the routes do: checked + normalised
    const client = await notifications.notifyOwnerPendingApproval({ channel: 'whatsapp', from: '233241000030', customerMessage: 'refund?', draftReply: '...', workspaceId: RESTAURANT });
    assert.strictEqual(client.whatsapp, 'sent');
    assert.strictEqual(client.telegram, 'not_used', "a client's customer messages never go to your Telegram");
    assert.deepStrictEqual(wa[0], { to: '233244111222', opts: { source: 'owner_alert', workspaceId: RESTAURANT } });
    assert.strictEqual(tg.length, 0);
    assert.strictEqual(await notifications.notifyOwnerFyi({ channel: 'whatsapp', from: 'x', customerMessage: 'a', sentReply: 'b', workspaceId: RESTAURANT }), 'not_used');

    const mine = await notifications.notifyOwnerPendingApproval({ channel: 'whatsapp', from: '233241000031', customerMessage: 'hi', draftReply: '...', workspaceId: YOU });
    assert.strictEqual(mine.telegram, 'sent');
    assert.deepStrictEqual(wa[1], { to: '233209999999', opts: { source: 'owner_alert', workspaceId: YOU } }, 'yours go from your number to your number');

    // The client's alert number writing in is the owner, not a customer: no AI reply.
    assert.strictEqual(await messaging.isOwnerNumber('233244111222', RESTAURANT), true);
    assert.strictEqual(await messaging.isOwnerNumber('233209999999', RESTAURANT), false, 'your number is a normal customer on a client\'s line');

    // 10. Lost or banned number: the business is emailed, you get a copy - once per loss.
    wa.length = 0; tg.length = 0;
    const realLost = notifications.notifySessionLost;
    const lost = [];
    notifications.notifySessionLost = async (a) => { lost.push(a); return realLost(a); };
    await messaging.handleSessionStatus({ sessionName: S_REST, status: 'FAILED' });
    await messaging.handleSessionStatus({ sessionName: S_REST, status: 'FAILED' });
    assert.strictEqual(lost.length, 1, 'alerted once, not on every status event');
    assert.strictEqual(lost[0].workspaceId, RESTAURANT);
    assert(tg.some((m) => /Client .* WhatsApp .* stopped working/.test(m.text)), 'you are told right away');
    await messaging.handleSessionStatus({ sessionName: S_REST, status: 'WORKING' });
    await messaging.handleSessionStatus({ sessionName: S_REST, status: 'FAILED' });
    assert.strictEqual(lost.length, 2, 'a new loss after it worked again alerts again');
    notifications.notifySessionLost = realLost;
    whatsappProvider.sendMessage = realWa;
    telegramProvider.sendMessage = realTg;
    console.log('✓ alerts: each business gets its own (its alert number, from its own WhatsApp); yours stay yours');
    console.log('✓ a disconnected or banned number alerts the business and you once, right away');
  }

  // 11. Settings validation and who may change what.
  {
    const bad = clientSettings.validate({ tier: 'spam', alert_number: '12', language: 'french', daily_reply_limit: 0 }, { allowed: clientSettings.OPERATOR_FIELDS });
    assert.strictEqual(bad.errors.length, 4, bad.errors.join(' | '));
    const own = clientSettings.validate({ tier: 'outreach', language: 'english' }, { allowed: clientSettings.CLIENT_FIELDS });
    assert.deepStrictEqual(own.patch, { language: 'english' }, 'a business can not change its own tier');
    const tpl = clientSettings.validate({ meta_templates: [{ name: 'New Stock!', language: 'en', params: 1 }] }, { allowed: clientSettings.OPERATOR_FIELDS });
    assert(tpl.fieldErrors.meta_templates);
    const { _isAppOwner } = require('../api/clientsRoutes');
    process.env.APP_OWNER_EMAIL = 'owner@example.com';
    assert.strictEqual(_isAppOwner({ user: { email: 'Owner@Example.com' } }), true);
    assert.strictEqual(_isAppOwner({ user: { email: 'client@restaurant.com' } }), false, 'clients can not open the Clients page');
    console.log('✓ settings are validated; clients change only their own alerts/town/language; tiers and limits are yours');
  }

  console.log('\nAll multi-client tests passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
