// WhatsApp provider layer (core/whatsapp) against a fake WAHA server - nothing
// real is sent. Covers numbers, the X-Api-Key header, session start + QR,
// webhook signatures, incoming routing / "stop" opt-outs / de-duplication,
// typing + delay, the outreach queue (gaps, daily cap, opt-outs), per-admin
// isolation, the shared Twilio message shape, and WAHA being unreachable.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.ALLOW_REAL_SENDS = '1'; // the fake fetch below is the only "network"
process.env.WHATSAPP_PROVIDER = 'waha';
process.env.WAHA_BASE_URL = 'http://waha.test';
process.env.WAHA_API_KEY = 'test-api-key';
process.env.WAHA_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.WAHA_WEBHOOK_BASE_URL = 'https://backend.example.com';
process.env.DAILY_WA_LIMIT = '2';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';

const assert = require('assert');
const crypto = require('crypto');

// ---- fake WAHA ----
const calls = [];
const wahaSessions = new Map();
let wahaDown = false;
global.fetch = async (url, init = {}) => {
  const u = new URL(url);
  calls.push({ method: init.method || 'GET', path: u.pathname, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
  if (wahaDown) { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; }
  const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const m = u.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(start|stop|logout))?$/);
  if (u.pathname === '/api/sessions' && init.method === 'POST') {
    const b = JSON.parse(init.body);
    wahaSessions.set(b.name, { name: b.name, status: 'SCAN_QR_CODE', config: b.config });
    return json(201, wahaSessions.get(b.name));
  }
  if (m) {
    const s = wahaSessions.get(m[1]);
    if (!s) return json(404, { message: 'not found' });
    if (m[2] === 'logout' || m[2] === 'stop') { s.status = 'STOPPED'; return json(200, s); }
    if (m[2] === 'start') { s.status = 'SCAN_QR_CODE'; return json(200, s); }
    if (init.method === 'PUT') { s.config = JSON.parse(init.body).config; return json(200, s); }
    return json(200, s);
  }
  if (/\/auth\/qr$/.test(u.pathname)) return json(200, { mimetype: 'image/png', data: 'UVJDT0RF' });
  if (u.pathname === '/api/sendText') return json(201, { id: `wamid-${calls.length}` });
  if (u.pathname === '/api/startTyping' || u.pathname === '/api/stopTyping') return json(200, {});
  return json(404, { message: 'unknown route' });
};

const config = require('../config');
const { normalizeNumber, toChatId } = require('../core/whatsapp/phone');
const { getProvider, sessionNameForUser, webhookUrl } = require('../core/whatsapp');
const waha = require('../core/whatsapp/WahaProvider');
const twilioProvider = require('../core/whatsapp/TwilioProvider');
const store = require('../core/whatsapp/store');
const messaging = require('../core/whatsapp/messaging');
const outbox = require('../core/whatsapp/outbox');
const registry = require('../agents/registry');

const sleeps = [];
messaging.timing.sleep = async (ms) => { sleeps.push(ms); };

function signed(body, secret = 'test-webhook-secret') {
  const raw = Buffer.from(JSON.stringify(body));
  return { rawBody: raw, body, headers: { 'x-webhook-hmac': crypto.createHmac('sha512', secret).update(raw).digest('hex') } };
}

const USER_A = '11111111-aaaa-aaaa-aaaa-111111111111';
const USER_B = '22222222-bbbb-bbbb-bbbb-222222222222';
const WS = 'wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww';

(async () => {
  // 1. Numbers
  assert.strictEqual(normalizeNumber('+233 24 123 4567'), '233241234567');
  assert.strictEqual(normalizeNumber('024 123 4567'), '233241234567');
  assert.strictEqual(normalizeNumber('whatsapp:+233241234567'), '233241234567');
  assert.strictEqual(normalizeNumber('233241234567@c.us'), '233241234567');
  assert.strictEqual(normalizeNumber('0044 7700 900123'), '447700900123');
  assert.strictEqual(normalizeNumber('12'), null);
  assert.strictEqual(toChatId('0241234567'), '233241234567@c.us');
  console.log('✓ numbers: country code, no "+" or leading zero');

  // 2. Provider choice and missing Twilio env vars
  assert.strictEqual(getProvider().name, 'waha');
  config.whatsapp.provider = 'twilio';
  assert.strictEqual(getProvider().name, 'twilio');
  assert.deepStrictEqual(await twilioProvider.getStatus(), { status: 'NOT_CONFIGURED', phoneNumber: null, pushName: null });
  config.whatsapp.provider = 'waha';
  console.log('✓ WHATSAPP_PROVIDER picks the provider; missing Twilio env vars just report NOT_CONFIGURED');

  // 3. Start a session: webhook registered with HMAC, QR available, X-Api-Key on every call
  const sessionA = sessionNameForUser(USER_A);
  assert.strictEqual(sessionA, 'admin_11111111aaaaaaaaaaaa111111111111');
  const started = await waha.startSession(sessionA, { webhookUrl: webhookUrl() });
  assert.strictEqual(started.status, 'SCAN_QR_CODE');
  const hook = wahaSessions.get(sessionA).config.webhooks[0];
  assert.strictEqual(hook.url, 'https://backend.example.com/api/webhooks/whatsapp');
  assert.deepStrictEqual(hook.events, ['message', 'session.status']);
  assert.strictEqual(hook.hmac.key, 'test-webhook-secret');
  assert.ok((await waha.getQR(sessionA)).startsWith('data:image/png;base64,'));
  assert.deepStrictEqual((await waha.getStatus(sessionA)).webhooks, ['https://backend.example.com/api/webhooks/whatsapp'], 'status reports the registered webhook (used to re-point it)');
  assert.ok(calls.every((c) => c.headers['X-Api-Key'] === 'test-api-key'), 'every WAHA call sends X-Api-Key');
  console.log('✓ session start registers the signed webhook; QR comes back as an image; X-Api-Key on every call');

  // 4. Webhook verification
  const msgEvent = {
    event: 'message', session: sessionA,
    payload: { id: 'in-1', from: '233200000001@c.us', fromMe: false, body: 'Hi, are you open today?', timestamp: 1767000000, _data: { notifyName: 'Ama' } },
  };
  const ok = waha.handleIncomingWebhook(signed(msgEvent));
  assert.strictEqual(ok.type, 'message');
  assert.deepStrictEqual(Object.keys(ok.message).sort(), ['contactName', 'contactNumber', 'text', 'timestamp', 'waMessageId']);
  assert.strictEqual(ok.message.contactNumber, '233200000001');
  assert.strictEqual(ok.message.contactName, 'Ama');
  assert.strictEqual(waha.handleIncomingWebhook(signed(msgEvent, 'wrong-secret')).type, 'rejected');
  assert.strictEqual(waha.handleIncomingWebhook({ ...signed(msgEvent), headers: {} }).type, 'rejected');
  assert.strictEqual(waha.handleIncomingWebhook(signed({ ...msgEvent, payload: { ...msgEvent.payload, from: '1203630@g.us' } })).type, 'ignored');
  assert.strictEqual(waha.handleIncomingWebhook(signed({ ...msgEvent, payload: { ...msgEvent.payload, fromMe: true } })).type, 'ignored');
  console.log('✓ webhooks: valid signature accepted; wrong/missing signature rejected; groups and own messages ignored');

  // 5. Twilio produces the same message shape
  const tw = twilioProvider.handleIncomingWebhook({ body: { MessageSid: 'SM1', From: 'whatsapp:+233200000002', Body: 'hello', ProfileName: 'Kofi' } });
  assert.deepStrictEqual(Object.keys(tw.message).sort(), Object.keys(ok.message).sort());
  assert.strictEqual(tw.message.contactNumber, '233200000002');
  console.log('✓ Twilio messages are normalized to the same shape as WAHA messages');

  // 6. Incoming pipeline: saved, routed to the agent with the session, duplicates and "stop" handled
  await store.upsertSession({ session_name: sessionA, user_id: USER_A, workspace_id: WS, status: 'WORKING', phone_number: '233500000000' });
  const routed = [];
  const realGetAgent = registry.getAgent;
  registry.getAgent = () => ({ handleIncomingMessage: async (m) => { routed.push(m); } });
  const incoming = { providerName: 'waha', sessionName: sessionA, userId: USER_A, workspaceId: WS, message: ok.message };
  assert.strictEqual((await messaging.handleIncomingMessage(incoming)).routed, true);
  assert.strictEqual(routed[0].session, sessionA, 'the reply goes out from the session the message arrived on');
  assert.strictEqual(routed[0].from, '233200000001');
  assert.strictEqual((await messaging.handleIncomingMessage(incoming)).reason, 'duplicate');
  const stop = await messaging.handleIncomingMessage({ ...incoming, message: { ...ok.message, waMessageId: 'in-2', text: 'STOP' } });
  assert.strictEqual(stop.optedOut, true);
  assert.strictEqual(routed.length, 1, 'duplicates and "stop" never reach the agent');
  assert.strictEqual(await store.isOptedOut(sessionA, '233200000001'), true);
  console.log('✓ incoming: saved, routed with its session; duplicates dropped; "STOP" records an opt-out');

  // 7. Replies: typing first, a random 2-6s wait, then the message; saved as outgoing
  calls.length = 0;
  sleeps.length = 0;
  await messaging.sendAndRecord({ sessionName: sessionA, to: '0200000003', text: 'Yes, 9 to 5.', userId: USER_A, workspaceId: WS, source: 'auto_reply', typing: true });
  assert.deepStrictEqual(calls.map((c) => c.path), ['/api/startTyping', '/api/stopTyping', '/api/sendText']);
  assert.ok(sleeps[0] >= 2000 && sleeps[0] <= 6000, `waited ${sleeps[0]}ms`);
  assert.strictEqual(calls[2].body.chatId, '233200000003@c.us');
  console.log(`✓ auto-reply: "typing...", waited ${sleeps[0]}ms (2-6s), then sent to 233200000003@c.us`);

  // 8. Admins only see their own conversations
  await store.upsertSession({ session_name: sessionNameForUser(USER_B), user_id: USER_B, workspace_id: WS, status: 'WORKING' });
  await store.saveMessage({ provider: 'waha', sessionName: sessionNameForUser(USER_B), userId: USER_B, workspaceId: WS, direction: 'in', contactNumber: '233200000099', text: 'private to B', waMessageId: 'b-1' });
  const convA = await store.listConversations({ userId: USER_A, workspaceId: WS });
  const convB = await store.listConversations({ userId: USER_B, workspaceId: WS });
  assert.ok(!convA.some((c) => c.contactNumber === '233200000099'), "A can't see B's chats");
  assert.deepStrictEqual(convB.map((c) => c.contactNumber), ['233200000099'], "B sees only B's chats");
  console.log("✓ per-admin isolation: each admin sees only their own session's conversations");

  // 9. Outreach queue: consent required, invalid/opted-out rejected, STOP after queuing skipped, 30-90s gaps, daily cap
  const incomingFrom = (n, id) => store.saveMessage({ provider: 'waha', sessionName: sessionA, userId: USER_A, workspaceId: WS, direction: 'in', contactNumber: n, text: 'hello', waMessageId: id });
  for (const n of ['233200000011', '233200000012', '233200000013', '233200000014', '233200000020']) await incomingFrom(n, `consent-${n}`);
  calls.length = 0;
  const queued = await outbox.enqueue({
    sessionName: sessionA, userId: USER_A, workspaceId: WS,
    recipients: [
      { number: '0200000001', text: 'Offer' },  // replied STOP above
      { number: '0200000077', text: 'Offer' },  // never messaged us: no consent
      { number: '0200000011', text: 'Offer' },
      { number: '0200000012', text: 'Offer' },
      { number: '0200000013', text: 'Offer' },
      { number: '0200000014', text: 'Offer' },
      { number: 'not-a-number', text: 'Offer' },
    ],
  });
  assert.strictEqual(queued.queued, 4);
  const why = Object.fromEntries(queued.rejected.map((r) => [r.number, r.reason]));
  assert.strictEqual(why['0200000001'], 'replied STOP');
  assert.ok(/hasn't messaged your WhatsApp first/.test(why['0200000077']), 'strangers are not messaged');
  assert.ok(why['not-a-number']);
  const runTick = async () => { outbox._nextSendAt.clear(); await outbox.tick(); };
  await runTick(); // send 11
  const gap = outbox._nextSendAt.get(sessionA) - Date.now();
  assert.ok(gap >= 29_000 && gap <= 90_000, `gap ${gap}ms`);
  await outbox.tick(); // gap not over: nothing happens
  assert.strictEqual(calls.filter((c) => c.path === '/api/sendText').length, 1, 'waits for the gap');
  await runTick(); // send 12 (daily limit is 2)
  await store.addOptOut(sessionA, '233200000013'); // replies STOP after being queued
  await runTick(); // 13: skipped at send time
  await runTick(); // 14: daily limit reached, held until tomorrow
  const rows = await store.listOutbox(USER_A);
  const by = (n) => rows.find((r) => r.contact_number === n).status;
  assert.strictEqual(by('233200000011'), 'sent');
  assert.strictEqual(by('233200000012'), 'sent');
  assert.strictEqual(by('233200000013'), 'skipped');
  assert.strictEqual(by('233200000014'), 'queued');
  assert.ok(outbox._nextSendAt.get(sessionA) > Date.now() + 60_000, 'resumes tomorrow');
  // Sales-agent outreach approvals go into the same queue (and the same consent rule)
  const plugin = require('../plugins/whatsapp/actions/sendMessage');
  const queuedViaTool = await plugin.run({ to: '0200000020', body: 'Lead offer', outreach: true }, { workspaceId: WS });
  assert.strictEqual(queuedViaTool.status, 'queued');
  await assert.rejects(plugin.run({ to: '0200000078', body: 'Cold offer', outreach: true }, { workspaceId: WS }), /hasn't messaged/);
  console.log(`✓ outreach: only to people who messaged first; STOP before or after queuing is respected; ${Math.round(gap / 1000)}s gap; daily limit (2) holds the rest`);

  // 9b. STOP / START and the opt-out guard on every send
  registry.getAgent = () => ({ handleIncomingMessage: async (m) => { routed.push(m); } });
  const C = '233200000030';
  const msg = (id, text) => ({ providerName: 'waha', sessionName: sessionA, userId: USER_A, workspaceId: WS, message: { waMessageId: id, contactNumber: C, contactName: 'Kofi', text, timestamp: new Date().toISOString() } });
  calls.length = 0;
  routed.length = 0;
  assert.strictEqual((await messaging.handleIncomingMessage(msg('s-1', 'Stop'))).optedOut, true);
  assert.strictEqual(calls.filter((c) => c.path === '/api/sendText' && c.body.text === messaging.STOP_NOTICE).length, 1, 'one STOP confirmation');
  await messaging.handleIncomingMessage(msg('s-2', 'STOP'));
  assert.strictEqual(calls.filter((c) => c.path === '/api/sendText').length, 1, 'no second confirmation');
  assert.strictEqual((await messaging.handleIncomingMessage(msg('s-3', 'how much is a website?'))).reason, 'opted out');
  assert.strictEqual(routed.length, 0, 'no auto-reply after STOP');
  await assert.rejects(messaging.sendAndRecord({ sessionName: sessionA, to: C, text: 'auto', source: 'auto_reply' }), (e) => e.code === 'OPTED_OUT');
  await assert.rejects(messaging.sendAndRecord({ sessionName: sessionA, to: C, text: 'promo', source: 'outreach' }), (e) => e.code === 'OPTED_OUT');
  await messaging.sendAndRecord({ sessionName: sessionA, to: C, text: 'Hi Kofi, sure - here are our prices.', source: 'manual' }); // admin can still answer by hand
  assert.strictEqual((await messaging.handleIncomingMessage(msg('s-4', 'cancel my order'))).reason, 'opted out', '"cancel my order" is not an opt-out keyword');
  assert.strictEqual((await messaging.handleIncomingMessage(msg('s-5', 'START'))).optedIn, true);
  assert.strictEqual(await store.isOptedOut(sessionA, C), false);
  assert.ok(calls.some((c) => c.path === '/api/sendText' && c.body.text === messaging.START_NOTICE), 'START confirmed');
  assert.strictEqual((await messaging.handleIncomingMessage(msg('s-6', 'great, what are your prices?'))).routed, true, 'auto-replies resume');
  console.log('✓ STOP: confirmed once, then no automatic messages (manual replies still allowed); START re-subscribes');

  // 9c. Auto-reply rate limit per contact
  const D = '233200000031';
  for (let i = 0; i < config.whatsapp.autoReplyMaxPerContactPerHour; i++) {
    await store.saveMessage({ provider: 'waha', sessionName: sessionA, userId: USER_A, workspaceId: WS, direction: 'out', contactNumber: D, text: 'reply', source: 'auto_reply', waMessageId: `r-${i}` });
  }
  const limited = await messaging.handleIncomingMessage({ providerName: 'waha', sessionName: sessionA, userId: USER_A, workspaceId: WS, message: { waMessageId: 'd-1', contactNumber: D, text: 'hello again', timestamp: new Date().toISOString() } });
  assert.strictEqual(limited.reason, 'rate limited');
  registry.getAgent = realGetAgent;
  console.log(`✓ auto-replies capped at ${config.whatsapp.autoReplyMaxPerContactPerHour} per contact per hour (no endless bot loops)`);

  // 9d. Meta's official Cloud API sits behind the same interface
  const meta = require('../core/whatsapp/MetaCloudProvider');
  config.whatsapp.provider = 'meta';
  assert.strictEqual(getProvider().name, 'meta');
  config.whatsapp.provider = 'waha';
  const metaIn = meta.handleIncomingWebhook({ body: { entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '233200000040', profile: { name: 'Esi' } }],
    messages: [{ id: 'wamid.1', from: '233200000040', type: 'text', text: { body: 'Hi' }, timestamp: '1767000000' }, { id: 'wamid.2', from: '233200000040', type: 'image' }],
  } }] }] } });
  assert.strictEqual(metaIn.messages.length, 1, 'text only');
  assert.deepStrictEqual(Object.keys(metaIn.messages[0]).sort(), Object.keys(ok.message).sort());
  assert.strictEqual(metaIn.messages[0].contactName, 'Esi');
  assert.strictEqual((await meta.getStatus()).status, 'NOT_CONFIGURED');
  console.log('✓ Meta Cloud API: same interface and message shape (WHATSAPP_PROVIDER=meta)');

  // 9e. The real webhook route: quick 200, same message twice handled once, bad signature 401
  {
    const http = require('http');
    const express = require('express');
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
    app.use('/api/webhooks/whatsapp', require('../api/whatsappWebhook'));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const post = (body, secret = 'test-webhook-secret') => new Promise((resolve, reject) => {
      const raw = Buffer.from(JSON.stringify(body));
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, path: '/api/webhooks/whatsapp', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': raw.length, 'X-Webhook-Hmac': crypto.createHmac('sha512', secret).update(raw).digest('hex') },
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.end(raw);
    });
    const hits = [];
    registry.getAgent = () => ({ handleIncomingMessage: async (m) => { hits.push(m); } });
    const event = { event: 'message', session: sessionA, payload: { id: 'dup-1', from: '233200000050@c.us', fromMe: false, body: 'Are you open on Sunday?', timestamp: 1767000000 } };
    const started = Date.now();
    assert.strictEqual(await post(event), 200);
    assert.ok(Date.now() - started < 1000, 'answers at once');
    assert.strictEqual(await post(event), 200, 'a repeat delivery still gets 200 (so WAHA stops retrying)');
    await new Promise((r) => setTimeout(r, 300));
    require('../api/whatsappWebhook')._recentIds.clear(); // a restarted backend (empty memory) still drops it, via the database
    assert.strictEqual(await post(event), 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(hits.length, 1, 'the same message is handled once');
    assert.strictEqual(await post(event, 'wrong-secret'), 401);
    registry.getAgent = realGetAgent;
    server.close();
    console.log('✓ webhook route: 200 at once; the same message delivered 3 times is handled once (memory + database); bad signature 401');
  }

  // 10. Disconnects flag the session for the Reconnect banner
  await messaging.handleSessionStatus({ sessionName: sessionA, status: 'FAILED' });
  assert.strictEqual((await store.getSessionByName(sessionA)).needs_reconnect, true);
  await messaging.handleSessionStatus({ sessionName: sessionA, status: 'WORKING' });
  assert.strictEqual((await store.getSessionByName(sessionA)).needs_reconnect, false);
  console.log('✓ FAILED marks the session for reconnect; WORKING clears it');

  // 11. WAHA unreachable: a clear error, no crash
  wahaDown = true;
  await assert.rejects(waha.getStatus(sessionA), (err) => err.name === 'WahaError' && /Can't reach WAHA/.test(err.message));
  await outbox.healthCheck(); // must not throw
  wahaDown = false;
  console.log('✓ WAHA down: clear "can\'t reach WAHA" error; background checks keep running');

  outbox.stop();
  console.log('\nwhatsapp-waha tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
