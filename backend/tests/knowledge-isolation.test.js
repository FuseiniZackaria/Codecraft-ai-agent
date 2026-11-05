// Multi-client: business B, signed in, tries every knowledge-base endpoint
// against business A's data - every list is empty and every read, change,
// delete, roll back or correction of A's items is refused. And a workspace
// member who isn't an owner/editor can't use any of it.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';

const assert = require('assert');
const express = require('express');
const mockProvider = require('../core/providers/mockProvider');
const memory = require('../memory');
const store = require('../core/knowledge/store');
const agentSettings = require('../core/knowledge/agentSettings');
const documents = require('../core/knowledge/documents');

const A = 'aaaaaaaa-0000-0000-0000-0000000000a7';
const B = 'bbbbbbbb-0000-0000-0000-0000000000b7';

mockProvider.complete = async () => ({ provider: 'mock', text: JSON.stringify({ reply: 'Hi', hold: false, reason: '' }), costEstimate: 0 });
memory.getBusinessProfile = async () => null;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: `user-${req.get('x-ws')}`, role: 'admin', workspaceId: req.get('x-ws'), workspaceRole: req.get('x-role') || 'owner' };
  next();
});
app.use('/api/agent-settings', require('../api/agentSettingsRoutes'));
app.use('/api/knowledge', require('../api/knowledgeRoutes'));
let base;
async function call(method, path, ws, body, role) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-ws': ws, ...(role ? { 'x-role': role } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Business A sets everything up.
  const v1 = await agentSettings.save(A, { instructions: 'A-SECRET instructions' }, { id: 'user-A' });
  const qaEntry = (await call('POST', '/api/knowledge/qa', A, { question: 'A question?', answer: 'A-SECRET answer' })).body.entry;
  const doc = (await call('POST', '/api/knowledge/documents', A, { filename: 'a.txt', data: Buffer.from('A-SECRET document').toString('base64') })).body.document;
  await documents._waitForProcessing();
  const chat = (await call('POST', '/api/knowledge/test-chat', A, { text: 'hello' })).body;

  // Business B sees none of it.
  const getAll = [
    ['GET', '/api/agent-settings'], ['GET', '/api/knowledge/qa'], ['GET', '/api/knowledge/documents'],
    ['GET', '/api/knowledge/test-chat'], ['GET', '/api/knowledge/corrections'],
  ];
  for (const [m, p] of getAll) {
    const r = await call(m, p, B);
    assert.strictEqual(r.status, 200, `${p}: ${r.status}`);
    assert(!JSON.stringify(r.body).includes('A-SECRET'), `${p} leaked A's data`);
  }
  assert.deepStrictEqual((await call('GET', '/api/agent-settings', B)).body.versions, []);
  console.log("✓ every list B can open is empty of A's data");

  // ...and can't touch any of A's items by id.
  const attempts = [
    ['GET', `/api/agent-settings/versions/${v1.id}`],
    ['POST', `/api/agent-settings/versions/${v1.id}/restore`],
    ['PATCH', `/api/knowledge/qa/${qaEntry.id}`, { answer: 'changed by B' }],
    ['DELETE', `/api/knowledge/qa/${qaEntry.id}`],
    ['GET', `/api/knowledge/documents/${doc.id}/text`],
    ['PUT', `/api/knowledge/documents/${doc.id}`, { filename: 'b.txt', data: Buffer.from('B').toString('base64') }],
    ['POST', `/api/knowledge/documents/${doc.id}/reprocess`],
    ['DELETE', `/api/knowledge/documents/${doc.id}`],
    ['POST', '/api/knowledge/corrections', { kind: 'test', messageId: chat.agent.id, question: 'q', answer: 'a' }],
  ];
  for (const [m, p, body] of attempts) {
    const r = await call(m, p, B, body);
    assert.strictEqual(r.status, 404, `${m} ${p} should be refused, got ${r.status}`);
  }
  assert.strictEqual((await store.getQa(A, qaEntry.id)).answer, 'A-SECRET answer');
  assert.strictEqual((await store.getDocument(A, doc.id)).status, 'ready');
  assert.strictEqual((await store.listVersions(A)).length, 1);
  assert.deepStrictEqual(await store.listQa(B), []);
  // B clearing its own test chat leaves A's.
  await call('DELETE', '/api/knowledge/test-chat', B);
  assert.strictEqual((await store.listTestMessages(A)).length, 2);
  console.log("✓ B can't read, change, delete, roll back, re-process or correct any of A's items");

  // A plain member (not owner/editor) of A can't use the knowledge base at all.
  for (const [m, p] of getAll) {
    assert.strictEqual((await call(m, p, A, null, 'member')).status, 403, `${p} for a member`);
  }
  assert.strictEqual((await call('GET', '/api/knowledge/qa', A, null, 'editor')).status, 200, 'an editor can');
  console.log('✓ only the workspace owner or an editor can open or change its knowledge base');

  server.close();
  console.log('All isolation checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
