// Test chat (Settings -> General -> Test chat): runs the real agent with the
// current instructions, Q&A and documents, shows what a customer would see,
// whether it'd be held and why, and which knowledge was given/used - and
// NEVER sends anything or alerts anyone. Over the real HTTP routes.

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
const agentSettings = require('../core/knowledge/agentSettings');
const testChat = require('../core/knowledge/testChat');
const policy = require('../core/whatsapp/replyPolicy');
const waha = require('../core/whatsapp/WahaProvider');
const BaseAgent = require('../agents/base/BaseAgent');

const WS_A = 'aaaaaaaa-0000-0000-0000-0000000000c1';
const WS_B = 'bbbbbbbb-0000-0000-0000-0000000000c2';

let modelAnswer = '';
let modelFails = false;
let lastPrompt = null;
let visionAnswer = null; // what an uploaded photo "shows"; an Error = the AI can't look at it
let visionCalls = 0;
mockProvider.complete = async (req) => {
  if (req.content) { // a photo
    visionCalls += 1;
    if (visionAnswer instanceof Error) throw visionAnswer;
    return { provider: 'mock', text: JSON.stringify(visionAnswer), costEstimate: 0 };
  }
  lastPrompt = req;
  if (modelFails) throw new Error('AI provider error: Claude is overloaded right now');
  return { provider: 'mock', text: modelAnswer, costEstimate: 0 };
};
// Anything that would reach a customer or the owner is counted - it must stay at zero.
const leaks = [];
orchestrator.approveTask = async (...a) => { leaks.push(['approveTask', a]); return { status: 'done' }; };
const realCreateTask = BaseAgent.prototype.createApprovalTask;
BaseAgent.prototype.createApprovalTask = async function (...a) { leaks.push(['createApprovalTask', a]); return realCreateTask.apply(this, a); };
for (const fn of ['notifyOwnerFyi', 'notifyOwnerPendingApproval', 'notifyOwnerAttention']) {
  notifications[fn] = async (...a) => { leaks.push([fn, a]); return {}; };
}
waha.sendMessage = async (...a) => { leaks.push(['waha.sendMessage', a]); return {}; };
memory.getBusinessProfile = async () => ({ business_name: 'Ama Bakery' });

const app = express();
app.use(express.json({ limit: '35mb' })); // same as the real server
app.use((req, _res, next) => { req.user = { id: 'user-1', role: 'admin', workspaceId: req.get('x-ws') || null, workspaceRole: 'owner' }; next(); });
app.use('/api/knowledge', require('../api/knowledgeRoutes'));
let base;
async function call(method, path, body, ws = WS_A) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-ws': ws }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
const say = (text, ws = WS_A) => call('POST', '/api/knowledge/test-chat', { text }, ws);
const answer = (reply, { hold = false, reason = '', sources = [] } = {}) => JSON.stringify({ reply, hold, reason, sources });

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  await store.createQa(WS_A, { question: 'Do you deliver?', answer: 'Yes, within Accra for GHS 20.' });
  await store.createQa(WS_A, { question: 'Are you open on Sunday?', answer: 'No, closed on Sundays.' });
  await store.createDocument(WS_A, { id: 'doc-1', filename: 'menu.pdf', storage_path: 'x', status: 'ready', chunk_count: 1, char_count: 40 });
  await store.replaceChunks(WS_A, 'doc-1', ['Meat pie: GHS 15. Sausage roll: GHS 12.']);

  // 1. A normal reply: what the customer would see, not held, which knowledge was given and used.
  {
    modelAnswer = answer('Good morning! Yes, we deliver within Accra.', { sources: ['Q1'] });
    const r = await say('Good morning, do you deliver?');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const { customer, agent } = r.body;
    assert.strictEqual(customer.role, 'customer');
    assert.strictEqual(customer.body, 'Good morning, do you deliver?');
    assert.strictEqual(agent.role, 'agent');
    assert.strictEqual(agent.body, 'Good morning! Yes, we deliver within Accra.');
    assert.strictEqual(agent.meta.held, false);
    assert.strictEqual(agent.meta.customerSees, agent.body);
    const q1 = agent.meta.sources.find((s) => s.label === 'Q1');
    assert(q1 && q1.type === 'qa' && q1.used === true && q1.title === 'Do you deliver?', JSON.stringify(agent.meta.sources));
    const d1 = agent.meta.sources.find((s) => s.label === 'D1');
    assert(d1 && d1.type === 'doc' && d1.title === 'menu.pdf' && d1.used === false, 'given but not used');
    assert.deepStrictEqual(agent.meta.cited, ['Q1']);
    assert.strictEqual(agent.meta.instructionsSource, 'default');
    console.log("✓ shows the customer's view, that it'd be sent straight away, and which Q&A/documents were given and used");
  }

  // 2. Nothing was sent or alerted - ever.
  {
    assert.deepStrictEqual(leaks, [], `nothing may be sent: ${JSON.stringify(leaks.map((l) => l[0]))}`);
    console.log('✓ the test chat never sends a WhatsApp message, never creates an approval task and never alerts you');
  }

  // 3. A held reply: the customer would get the hold message; the suggestion and reason are shown.
  {
    modelAnswer = answer('A wedding cake is GHS 900.', { sources: [] });
    const r = await say('How much is a wedding cake?');
    const { agent } = r.body;
    assert.strictEqual(agent.meta.held, true);
    assert(/pric|cost|quote/i.test(agent.meta.reason), agent.meta.reason);
    assert.strictEqual(agent.meta.customerSees, null, 'a real customer gets nothing until you reply');
    assert.strictEqual(agent.body, '');
    assert.strictEqual(agent.meta.draft, 'A wedding cake is GHS 900.');
    assert.deepStrictEqual(leaks, []);
    console.log('✓ a held reply shows that the customer gets nothing yet, plus the suggestion and why');
  }

  // 4. The conversation carries on, as the customer saw it.
  {
    modelAnswer = answer('We are closed on Sundays.', { sources: ['Q2'] });
    await say('And on Sunday?');
    assert(lastPrompt.prompt.includes('Customer: Good morning, do you deliver?'));
    assert(!/^Ian:\s*$/m.test(lastPrompt.prompt), 'the unsent held reply is not in the conversation');
    assert(!lastPrompt.prompt.includes('GHS 900'), "the unsent suggestion isn't part of the conversation");
    assert(lastPrompt.system.includes("don't greet again"), 'mid-conversation');
    console.log('✓ follow-up messages see the conversation as the customer saw it');
  }

  // 5. Changes to the instructions show up on the next test reply.
  {
    await agentSettings.save(WS_A, { agent_name: 'Esi', instructions: 'You are {{agent_name}}. Always say "Akwaaba to Ama Bakery".' }, { id: 'user-1' });
    modelAnswer = answer('Akwaaba to Ama Bakery!');
    const r = await say('Hello');
    assert(lastPrompt.system.includes('You are Esi. Always say "Akwaaba to Ama Bakery".'));
    assert.strictEqual(r.body.agent.meta.instructionsVersion, 1);
    assert.strictEqual(r.body.agent.meta.instructionsSource, 'saved');
    console.log('✓ edits to the instructions are used on the very next test reply');
  }

  // 6. AI down: the customer's message is kept and the reason is shown; nothing is sent.
  {
    modelFails = true;
    const r = await say('Are you there?');
    modelFails = false;
    assert.strictEqual(r.status, 200);
    assert(/couldn't answer/.test(r.body.agent.meta.error), JSON.stringify(r.body.agent));
    assert.deepStrictEqual(leaks, []);
    console.log('✓ if the AI is down the test chat says so (no alert is sent)');
  }

  // 7. List, isolation, clear.
  {
    let r = await call('GET', '/api/knowledge/test-chat');
    assert.strictEqual(r.body.messages.length, 10, String(r.body.messages.length));
    assert.strictEqual(r.body.messages[0].body, 'Good morning, do you deliver?', 'oldest first');
    r = await call('GET', '/api/knowledge/test-chat', null, WS_B);
    assert.deepStrictEqual(r.body.messages, [], "B doesn't see A's test chat");
    modelAnswer = answer('Hi from Kojo Motors');
    await say('Hi', WS_B);
    assert(!lastPrompt.system.includes('GHS 20') && !lastPrompt.system.includes('Meat pie'), "B's agent never sees A's knowledge");
    await call('DELETE', '/api/knowledge/test-chat');
    assert.deepStrictEqual((await call('GET', '/api/knowledge/test-chat')).body.messages, []);
    assert.strictEqual((await call('GET', '/api/knowledge/test-chat', null, WS_B)).body.messages.length, 2, "clearing A leaves B's");
    console.log('✓ each business has its own test chat; "start over" clears only yours');
  }

  // 8. Input checks and the hourly limit.
  {
    assert.strictEqual((await say('   ')).status, 400);
    assert.strictEqual((await say('x'.repeat(testChat.MAX_TEXT + 1))).status, 400);
    testChat._sentLog.set(WS_A, Array(testChat.HOURLY_LIMIT).fill(Date.now()));
    const r = await say('one more');
    assert.strictEqual(r.status, 429);
    assert(/real AI call/.test(r.body.error));
    testChat._sentLog.delete(WS_A);
    console.log('✓ empty/too-long messages are refused; an hourly limit stops runaway AI costs');
  }

  // 9. The agent's "sources" answer is cleaned up.
  {
    const p = policy.parseDraft(JSON.stringify({ reply: 'x', hold: false, sources: ['[q1]', 'D2', 'D2', 'bogus', 7] }));
    assert.deepStrictEqual(p.sources, ['Q1', 'D2']);
    assert.deepStrictEqual(policy.parseDraft(JSON.stringify({ reply: 'x' })).sources, []);
    console.log('✓ the list of sources the agent reports is cleaned up (only real [Q..]/[D..] labels)');
  }

  // 11. Photos in the Test chat (G): looked at, matched to products, answered - nothing sent.
  {
    const catalogStore = require('../core/catalog/store');
    await catalogStore.createProduct(WS_A, { name: 'Meat Pie', stock_status: 'in_stock', image_url: 'https://cdn.example.com/pie.jpg' });
    await call('DELETE', '/api/knowledge/test-chat');
    const photo = { data: Buffer.from('fake-jpeg-bytes-for-test').toString('base64'), mimetype: 'image/jpeg' };
    visionAnswer = { kind: 'product', description: 'a golden meat pie', search_terms: ['meat', 'pie'] };
    modelAnswer = JSON.stringify({ reply: 'Yes, we have meat pies!', hold: false, reason: '', sources: ['P1'], photos: ['P1'] });
    let r = await call('POST', '/api/knowledge/test-chat', { text: '', image: photo });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.customer.body, '[photo]');
    assert.strictEqual(r.body.customer.meta.seen.description, 'a golden meat pie');
    assert(lastPrompt.prompt.includes('[The customer sent a photo. It shows: a golden meat pie.'));
    assert(lastPrompt.system.includes('[P1] Meat Pie'));
    assert.deepStrictEqual(r.body.agent.meta.photos, [{ name: 'Meat Pie', image_url: 'https://cdn.example.com/pie.jpg', product_url: null }]);
    assert(r.body.agent.meta.sources.some((x) => x.type === 'product' && x.title === 'Meat Pie' && x.used));
    assert.deepStrictEqual(leaks, [], 'nothing sent');
    // the next message remembers what the photo showed
    modelAnswer = JSON.stringify({ reply: 'GHS 15 each.', hold: false, reason: '' });
    await say('how much is it?');
    assert(lastPrompt.prompt.includes('Customer: [The customer sent a photo. It shows: a golden meat pie.'), lastPrompt.prompt);
    // a receipt photo is never confirmed
    visionAnswer = { kind: 'payment', description: 'a MoMo transfer confirmation', text: 'You have sent GHS 30', search_terms: [] };
    modelAnswer = JSON.stringify({ reply: 'Payment received!', hold: false, reason: '' });
    r = await call('POST', '/api/knowledge/test-chat', { text: 'paid', image: photo });
    assert.strictEqual(r.body.agent.meta.kind, 'payment');
    assert.strictEqual(r.body.agent.meta.customerSees, null, 'a receipt photo gets no reply until you check');
    // the AI can't look at it -> explained
    visionAnswer = new Error('overloaded');
    r = await call('POST', '/api/knowledge/test-chat', { text: '', image: photo });
    assert(/couldn't look at the photo/.test(r.body.agent.meta.error));
    // not a photo / too big
    assert.strictEqual((await call('POST', '/api/knowledge/test-chat', { image: { data: photo.data, mimetype: 'application/pdf' } })).status, 400);
    assert.strictEqual((await call('POST', '/api/knowledge/test-chat', { image: { data: 'A'.repeat(7 * 1024 * 1024), mimetype: 'image/png' } })).status, 400);
    assert.deepStrictEqual(leaks, []);
    console.log('✓ G: photos in the Test chat are looked at, matched to products and answered (receipts never confirmed); nothing is sent');
  }

  // 10. A delivery AREA is fine; a delivery TIME is a promise (held).
  {
    const held = (draft) => policy.decideRouting({ incoming: 'hi', draft, knowledge: 'Accra Tema Kumasi' }).hold;
    assert.strictEqual(held('Yes, we deliver within Accra.'), false);
    assert.strictEqual(held('Your order will be delivered within Tema and Accra.'), false);
    assert.strictEqual(held('We can deliver it within 2 days.'), true);
    assert.strictEqual(held('It will be ready by Friday.'), true);
    assert.strictEqual(held('It will be done in a few hours.'), true);
    console.log('✓ "we deliver within Accra" is sent; "we can deliver within 2 days" waits for you');
  }

  server.close();
  console.log('All test-chat checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
