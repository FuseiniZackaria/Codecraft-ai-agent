// "Correct this answer": the right answer to an agent reply (Test chat or a
// real WhatsApp reply in the Inbox) is saved straight into the Q&A, used on
// the agent's next reply; re-correcting updates the same entry; only the
// agent's own replies that this person may see can be corrected.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
delete process.env.WA_AUTO_REPLY;

const assert = require('assert');
const express = require('express');
const mockProvider = require('../core/providers/mockProvider');
const memory = require('../memory');
const store = require('../core/knowledge/store');
const waStore = require('../core/whatsapp/store');

const WS_A = 'aaaaaaaa-0000-0000-0000-0000000000e1';
const WS_B = 'bbbbbbbb-0000-0000-0000-0000000000e2';

let modelAnswer = JSON.stringify({ reply: 'Sorry, I am not sure.', hold: false, reason: '', sources: [] });
let lastPrompt = null;
mockProvider.complete = async (req) => { lastPrompt = req; return { provider: 'mock', text: modelAnswer, costEstimate: 0 }; };
memory.getBusinessProfile = async () => ({ business_name: 'Ama Bakery' });

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: req.get('x-user') || 'user-1', role: 'admin', workspaceId: req.get('x-ws') || null, workspaceRole: 'owner' };
  next();
});
app.use('/api/knowledge', require('../api/knowledgeRoutes'));
let base;
async function call(method, path, body, { ws = WS_A, user = 'user-1' } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-ws': ws, 'x-user': user }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
const correct = (body, opts) => call('POST', '/api/knowledge/corrections', body, opts);

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // 1. Correct a Test chat reply -> a Q&A entry, used on the next reply.
  let testReplyId;
  {
    const r = await call('POST', '/api/knowledge/test-chat', { text: 'Do you make gluten-free bread?' });
    testReplyId = r.body.agent.id;
    const c = await correct({ kind: 'test', messageId: testReplyId, question: 'Do you make gluten-free bread?', answer: 'Yes, on Tuesdays and Fridays. Order a day ahead.' });
    assert.strictEqual(c.status, 201, JSON.stringify(c.body));
    assert.strictEqual(c.body.created, true);
    assert.strictEqual(c.body.entry.source, 'correction');
    assert.strictEqual(c.body.entry.source_message_id, `test:${testReplyId}`);
    assert.strictEqual(c.body.entry.enabled, true);

    const list = await call('GET', '/api/knowledge/qa');
    assert.strictEqual(list.body.entries.length, 1);
    assert.strictEqual(list.body.entries[0].source, 'correction', 'shows in the Q&A list with its badge');
    const map = (await call('GET', '/api/knowledge/corrections')).body.corrections;
    assert.strictEqual(map[`test:${testReplyId}`], c.body.entry.id, 'the reply is marked as corrected');

    await call('POST', '/api/knowledge/test-chat', { text: 'Gluten-free bread?' });
    assert(lastPrompt.system.includes('Yes, on Tuesdays and Fridays. Order a day ahead.'), 'the correction is used on the next reply');
    console.log('✓ correcting a Test chat reply saves a Q&A entry the agent uses from its next reply');
  }

  // 2. Correcting the same reply again updates that entry (and switches it back on) - no duplicate.
  {
    const first = (await store.listQa(WS_A))[0];
    await store.updateQa(WS_A, first.id, { enabled: false });
    const c = await correct({ kind: 'test', messageId: testReplyId, question: 'Do you make gluten-free bread?', answer: 'Yes, every Tuesday. Order a day ahead.' });
    assert.strictEqual(c.status, 200);
    assert.strictEqual(c.body.created, false);
    assert.strictEqual(c.body.entry.id, first.id);
    assert.strictEqual(c.body.entry.enabled, true);
    assert.strictEqual((await store.listQa(WS_A)).length, 1, 'still one entry');
    console.log('✓ correcting the same reply again updates that Q&A entry instead of adding a duplicate');
  }

  // 3. Correct a real WhatsApp reply from the Inbox.
  let outId; let inId; let othersId;
  {
    const base = { provider: 'waha', sessionName: 'default', userId: 'user-1', workspaceId: WS_A, contactNumber: '233200000099' };
    inId = (await waStore.saveMessage({ ...base, direction: 'in', text: 'Do you sell sobolo?' })).message.id;
    outId = (await waStore.saveMessage({ ...base, direction: 'out', text: 'Let me check with the team.', source: 'auto_reply' })).message.id;
    othersId = (await waStore.saveMessage({ ...base, userId: 'user-2', direction: 'out', text: 'Hi', source: 'auto_reply' })).message.id;

    const c = await correct({ kind: 'whatsapp', messageId: outId, question: 'Do you sell sobolo?', answer: 'Yes, GHS 10 a bottle.' });
    assert.strictEqual(c.status, 201, JSON.stringify(c.body));
    assert.strictEqual(c.body.entry.source_message_id, `whatsapp:${outId}`);
    const map = (await call('GET', '/api/knowledge/corrections')).body.corrections;
    assert(map[`whatsapp:${outId}`], 'Inbox reply marked as corrected');
    console.log('✓ correcting a real WhatsApp reply in the Inbox saves it to the Q&A');
  }

  // 4. Only the agent's own replies that you may see.
  {
    let r = await correct({ kind: 'whatsapp', messageId: inId, question: 'q', answer: 'a' });
    assert.strictEqual(r.status, 404, "a customer's message isn't an agent reply");
    r = await correct({ kind: 'whatsapp', messageId: othersId, question: 'q', answer: 'a' });
    assert.strictEqual(r.status, 404, "another admin's WhatsApp isn't yours");
    const customerTest = (await store.listTestMessages(WS_A)).find((m) => m.role === 'customer');
    r = await correct({ kind: 'test', messageId: customerTest.id, question: 'q', answer: 'a' });
    assert.strictEqual(r.status, 404);
    r = await correct({ kind: 'test', messageId: testReplyId, question: 'q', answer: 'a' }, { ws: WS_B });
    assert.strictEqual(r.status, 404, "another business can't correct your test chat");
    assert.deepStrictEqual(await store.listQa(WS_B), []);
    r = await correct({ kind: 'test', messageId: 'not-a-real-id', question: 'q', answer: 'a' });
    assert.strictEqual(r.status, 404);
    console.log("✓ only the agent's replies you can see can be corrected - not customers' messages or another business's");
  }

  // 5. Input checks.
  {
    let r = await correct({ kind: 'email', messageId: outId, question: 'q', answer: 'a' });
    assert.strictEqual(r.status, 400);
    r = await correct({ kind: 'whatsapp', messageId: outId, question: 'Do you sell sobolo?', answer: '  ' });
    assert.strictEqual(r.status, 400);
    assert(/answer can't be empty/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));
    console.log('✓ a correction needs a question and an answer');
  }

  server.close();
  console.log('All correction checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
