// Q&A entries (Settings -> General -> Q&A): add / edit / switch off / delete
// over the real HTTP routes, one workspace never touching another's, the
// matching that picks entries for a customer message, and the WhatsApp agent
// using them on its very next reply (switched-off ones never).
// Nothing real is sent - the AI, the send path and the alerts are stubbed.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
delete process.env.WA_AUTO_REPLY;

const assert = require('assert');
const express = require('express');
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const notifications = require('../core/notifications');
const memory = require('../memory');
const store = require('../core/knowledge/store');
const retrieval = require('../core/knowledge/retrieval');
const WhatsAppAgent = require('../agents/whatsapp/WhatsAppAgent');

const WS_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const WS_B = 'bbbbbbbb-0000-0000-0000-00000000000b';

let modelAnswer = JSON.stringify({ reply: 'Yes, we do!', hold: false, reason: '' });
let lastPrompt = null;
mockProvider.complete = async (req) => { lastPrompt = req; return { provider: 'mock', text: modelAnswer, costEstimate: 0 }; };
orchestrator.approveTask = async (taskId) => ({ ...(await memory.getTask(taskId)), status: 'done' });
notifications.notifyOwnerFyi = async () => 'sent';
notifications.notifyOwnerPendingApproval = async () => ({});
memory.getBusinessProfile = async () => ({ business_name: 'Ama Bakery' });

// The real routes behind a fake login (role per request via a header).
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const ws = req.get('x-ws');
  req.user = { id: 'user-1', email: 'owner@example.com', role: 'admin', workspaceId: ws || null, workspaceRole: req.get('x-role') || 'owner' };
  next();
});
app.use('/api/knowledge', require('../api/knowledgeRoutes'));

let base;
async function call(method, path, body, { ws = WS_A, role = 'owner' } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(ws ? { 'x-ws': ws } : {}), 'x-role': role },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const agent = new WhatsAppAgent();
const ask = (body, workspaceId = WS_A) => agent.handleIncomingMessage({ from: '233200000010', body, workspaceId, session: 'default', userId: 'admin-1' });

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // 1. Add, list, edit, switch off, delete.
  let deliveryId;
  {
    let r = await call('POST', '/api/knowledge/qa', { question: 'Do you deliver?', answer: 'Yes, within Accra. Call 0244 123 456 to order.' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    deliveryId = r.body.entry.id;
    assert.strictEqual(r.body.entry.enabled, true);
    assert.strictEqual(r.body.entry.source, 'manual');

    r = await call('POST', '/api/knowledge/qa', { question: '  ', answer: 'x'.repeat(4001) });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.details.length, 2, r.body.details.join(' | '));

    await call('POST', '/api/knowledge/qa', { question: 'Are you open on Sunday?', answer: 'No, we are closed on Sundays.' });
    r = await call('GET', '/api/knowledge/qa');
    assert.deepStrictEqual(r.body.entries.map((e) => e.question), ['Are you open on Sunday?', 'Do you deliver?'], 'newest first');

    r = await call('PATCH', `/api/knowledge/qa/${deliveryId}`, { answer: 'Yes, within Accra and Tema. Call 0244 123 456 to order.' });
    assert.strictEqual(r.status, 200);
    assert(r.body.entry.answer.includes('Tema'));
    r = await call('PATCH', `/api/knowledge/qa/${deliveryId}`, { enabled: 'no' });
    assert.strictEqual(r.status, 400, 'enabled must be true/false');
    r = await call('PATCH', `/api/knowledge/qa/${deliveryId}`, {});
    assert.strictEqual(r.status, 400, 'nothing to change');
    console.log('✓ Q&A: add, list (newest first), edit and validation over the API');
  }

  // 2. Workspaces are separate; permissions.
  {
    let r = await call('GET', '/api/knowledge/qa', null, { ws: WS_B });
    assert.deepStrictEqual(r.body.entries, [], "B doesn't see A's entries");
    r = await call('PATCH', `/api/knowledge/qa/${deliveryId}`, { answer: 'hacked' }, { ws: WS_B });
    assert.strictEqual(r.status, 404);
    r = await call('DELETE', `/api/knowledge/qa/${deliveryId}`, null, { ws: WS_B });
    assert.strictEqual(r.status, 404);
    assert((await store.getQa(WS_A, deliveryId)).answer.includes('Tema'), "A's entry untouched");
    r = await call('GET', '/api/knowledge/qa', null, { role: 'member' });
    assert.strictEqual(r.status, 403);
    r = await call('GET', '/api/knowledge/qa', null, { ws: null });
    assert.strictEqual(r.status, 400);
    console.log("✓ one workspace can't see, edit or delete another's entries; only owners/editors can edit");
  }

  // 3. The agent uses the entries on its next reply - and its phone number isn't "made up".
  {
    modelAnswer = JSON.stringify({ reply: 'Yes, within Accra and Tema. Call 0244 123 456 to order.', hold: false, reason: '' });
    const r = await ask('Hi, do you do delivery?');
    assert(lastPrompt.system.includes('[Q') && lastPrompt.system.includes('Yes, within Accra and Tema'), 'Q&A in the prompt');
    assert(lastPrompt.system.includes('closed on Sundays'), 'small set: every switched-on entry is sent');
    assert.strictEqual(r.held, false, `a phone number from the Q&A is allowed: ${r.reason}`);
    console.log('✓ the agent sees the Q&A on its next reply; details from the Q&A are not treated as made up');
  }

  // 4. Switched off = never used; switched back on = used again; deleted = gone.
  {
    await call('PATCH', `/api/knowledge/qa/${deliveryId}`, { enabled: false });
    await ask('Do you deliver?');
    assert(!lastPrompt.system.includes('Accra and Tema'), 'switched-off entry not sent');
    await call('PATCH', `/api/knowledge/qa/${deliveryId}`, { enabled: true });
    await ask('Do you deliver?');
    assert(lastPrompt.system.includes('Accra and Tema'), 'switched back on');
    const r = await call('DELETE', `/api/knowledge/qa/${deliveryId}`);
    assert.strictEqual(r.status, 200);
    await ask('Do you deliver?');
    assert(!lastPrompt.system.includes('Accra and Tema'), 'deleted');
    assert.strictEqual((await call('DELETE', `/api/knowledge/qa/${deliveryId}`)).status, 404);
    console.log('✓ switched-off and deleted entries are never used; switching back on works immediately');
  }

  // 5. Another workspace's agent never sees these entries.
  {
    await ask('Are you open on Sunday?', WS_B);
    assert(!lastPrompt.system.includes('closed on Sundays'));
    console.log("✓ the agent for one business never sees another business's Q&A");
  }

  // 6. A big Q&A list: only the best matches are sent, numbered [Q1]...
  {
    for (let i = 0; i < 40; i++) {
      await store.createQa(WS_B, { question: `Do you sell product number ${i}?`, answer: `Yes, product ${i} is in stock.` });
    }
    await store.createQa(WS_B, { question: 'What are your opening hours?', answer: 'Monday to Saturday, 8am to 6pm.' });
    await store.createQa(WS_B, { question: 'Do you offer delivery?', answer: 'Yes, delivery within Kumasi.' });
    await store.createQa(WS_B, { question: 'Weekend opening?', answer: 'Saturdays only.', enabled: false });
    const found = await retrieval.forMessage(WS_B, 'what time do you open on Saturday?');
    assert(found.qa.length >= 1 && found.qa.length <= retrieval.MAX_QA, `found ${found.qa.length}`);
    assert.strictEqual(found.qa[0].question, 'What are your opening hours?', JSON.stringify(found.qa.map((q) => q.question)));
    assert(!found.qa.some((q) => q.question === 'Weekend opening?'), 'switched-off entries are never searched');
    assert.strictEqual(found.qa[0].label, 'Q1');
    const delivery = await retrieval.forMessage(WS_B, 'can you deliver to me?');
    assert.strictEqual(delivery.qa[0].question, 'Do you offer delivery?', '"deliver" matches "delivery"');
    const followUp = await retrieval.forMessage(WS_B, 'and on weekends?', 'what are your opening hours');
    assert.strictEqual(followUp.qa[0].question, 'What are your opening hours?', 'short follow-ups use the previous message too');
    const nothing = await retrieval.forMessage(WS_B, 'hello there');
    assert.strictEqual(nothing.qa.length, 0);
    console.log('✓ big lists: the best-matching switched-on entries are picked (different word endings and follow-ups too)');
  }

  // 7. Migration not run: no Q&A, but the agent still replies.
  {
    const real = store.listQa;
    store.listQa = async () => { const e = new Error('missing'); e.code = 'MIGRATION_MISSING'; throw e; };
    const r = await ask('Do you deliver?');
    assert.ok(r.draft, 'still replied');
    store.listQa = real;
    console.log('✓ if the Q&A tables are missing, the agent still replies (and holds anything it does not know)');
  }

  server.close();
  console.log('All knowledge Q&A checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
