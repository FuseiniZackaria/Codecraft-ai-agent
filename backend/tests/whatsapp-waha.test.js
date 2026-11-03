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
  registry.getAgent = realGetAgent;
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

  // 9. Outreach queue: invalid numbers rejected, opted-out skipped, 30-90s gaps, daily cap
  calls.length = 0;
  const queued = await outbox.enqueue({
    sessionName: sessionA, userId: USER_A, workspaceId: WS,
    recipients: [
      { number: '0200000001', text: 'Offer' },  // opted out above
      { number: '0200000011', text: 'Offer' },
      { number: '0200000012', text: 'Offer' },
      { number: '0200000013', text: 'Offer' },
      { number: 'not-a-number', text: 'Offer' },
    ],
  });
  assert.strictEqual(queued.queued, 4);
  assert.strictEqual(queued.rejected.length, 1);
  const runTick = async () => { outbox._nextSendAt.clear(); await outbox.tick(); };
  await runTick(); // opted-out contact: skipped, nothing sent
  await runTick(); // send 1
  const gap = outbox._nextSendAt.get(sessionA) - Date.now();
  assert.ok(gap >= 29_000 && gap <= 90_000, `gap ${gap}ms`);
  await outbox.tick(); // gap not over: nothing happens
  assert.strictEqual(calls.filter((c) => c.path === '/api/sendText').length, 1, 'waits for the gap');
  await runTick(); // send 2 (daily limit is 2)
  await runTick(); // limit reached: held until tomorrow
  const rows = await store.listOutbox(USER_A);
  const by = (n) => rows.find((r) => r.contact_number === n).status;
  assert.strictEqual(by('233200000001'), 'skipped');
  assert.strictEqual(by('233200000011'), 'sent');
  assert.strictEqual(by('233200000012'), 'sent');
  assert.strictEqual(by('233200000013'), 'queued');
  assert.ok(outbox._nextSendAt.get(sessionA) > Date.now() + 60_000, 'resumes tomorrow');
  // Sales-agent outreach approvals go into the same queue instead of sending at once
  const plugin = require('../plugins/whatsapp/actions/sendMessage');
  const queuedViaTool = await plugin.run({ to: '0200000020', body: 'Lead offer', outreach: true }, { workspaceId: WS });
  assert.strictEqual(queuedViaTool.status, 'queued');
  assert.ok((await store.listOutbox(USER_A)).some((r) => r.contact_number === '233200000020' && r.status === 'queued'));
  console.log(`✓ outreach: opted-out skipped, ${Math.round(gap / 1000)}s gap between sends, daily limit (2) holds the rest until tomorrow`);

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
