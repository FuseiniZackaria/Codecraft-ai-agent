// An invited admin in a NEW workspace must not see the owner's tasks or
// activity: not through lists, not by task id (read / approve / reject /
// edit / delete), not through the live activity stream. Rows with no
// workspace_id (legacy / background-created) belong to the owner only.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.WORKSPACE_GUARD_MODE = 'log';

const assert = require('assert');
const express = require('express');
const http = require('http');

const OWNER_WS = 'aaaaaaaa-0000-0000-0000-00000000000a';
const NEW_WS = 'bbbbbbbb-0000-0000-0000-00000000000b';

async function main() {
  const workspaceContext = require('../core/workspaceContext');
  workspaceContext.getAppOwnerWorkspaceId = async () => OWNER_WS;

  const memory = require('../memory');
  const activityLog = require('../core/activityLog');
  const routes = require('../api/routes');
  const eventsRoutes = require('../api/eventsRoutes');

  const now = new Date().toISOString();
  await memory.saveTask({ id: 't-owner', agent: 'sales', instruction: 'Owner outreach', status: 'pending_approval', irreversible: true, toolCall: { tool: 'gmail.sendEmail', irreversible: true }, payload: { to: 'x@y.com', subject: 's', body: 'b' }, created_at: now, workspace_id: OWNER_WS }, { workspaceId: OWNER_WS });
  await memory.saveTask({ id: 't-legacy', agent: 'telegram', instruction: 'Webhook reply (no workspace)', status: 'done', created_at: now }, { scope: 'system', systemCaller: 'test' });
  await memory.saveTask({ id: 't-new', agent: 'research', instruction: 'New admin task', status: 'done', created_at: now, workspace_id: NEW_WS }, { workspaceId: NEW_WS });
  await activityLog.record('owner-agent', 'task_completed', 'x', { workspaceId: OWNER_WS, taskId: 't-owner' });
  await activityLog.record('webhook', 'message_received', 'telegram', { scope: 'system', systemCaller: 'test' });
  await activityLog.record('new-agent', 'task_completed', 'y', { workspaceId: NEW_WS, taskId: 't-new' });

  let user = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api', routes);
  app.use('/api/events', eventsRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, body) => {
    const res = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json };
  };

  try {
    const newAdmin = { id: 'u-new', email: 'new@example.com', role: 'admin', workspaceId: NEW_WS };
    const owner = { id: 'u-owner', email: 'owner@example.com', role: 'admin', workspaceId: OWNER_WS };

    // --- Lists ---
    user = newAdmin;
    let r = await call('GET', '/tasks');
    assert.deepStrictEqual(r.body.map((t) => t.id), ['t-new'], 'new workspace sees only its own task (not the owner\'s, not legacy)');
    r = await call('GET', '/events/recent');
    assert.deepStrictEqual(r.body.map((e) => e.actor), ['new-agent'], 'new workspace sees only its own activity');
    user = owner;
    r = await call('GET', '/tasks');
    assert.deepStrictEqual(r.body.map((t) => t.id).sort(), ['t-legacy', 't-owner'], 'owner sees its own and legacy tasks');
    r = await call('GET', '/events/recent');
    assert.deepStrictEqual(r.body.map((e) => e.actor).sort(), ['owner-agent', 'webhook'], 'owner sees its own and legacy activity');
    console.log('✓ task and activity lists: new workspace sees only its own; legacy rows go to the owner only');

    // --- By id ---
    user = newAdmin;
    for (const [method, p, body] of [
      ['GET', '/tasks/t-owner'],
      ['GET', '/tasks/t-legacy'],
      ['POST', '/tasks/t-owner/approve'],
      ['POST', '/tasks/t-owner/reject'],
      ['PATCH', '/tasks/t-owner/payload', { payload: { to: 'attacker@evil.com' } }],
      ['DELETE', '/tasks/t-owner'],
    ]) {
      r = await call(method, p, body);
      assert.strictEqual(r.status, 404, `${method} ${p} must be 404 for another workspace (got ${r.status})`);
    }
    r = await call('POST', '/tasks/bulk-delete', { ids: ['t-owner', 't-legacy'] });
    assert.strictEqual(r.body.deleted, 0);
    const ownerTask = await memory.getTask('t-owner');
    assert.ok(ownerTask, 'owner task still exists');
    assert.strictEqual(ownerTask.status, 'pending_approval', 'owner task was not approved/rejected');
    assert.strictEqual(ownerTask.payload.to, 'x@y.com', 'owner task payload untouched');
    assert.ok(await memory.getTask('t-legacy'));
    r = await call('GET', '/tasks/t-new');
    assert.strictEqual(r.status, 200, 'own task is still readable');
    console.log('✓ by id: another workspace\'s task cannot be read, approved, rejected, edited or deleted');

    // --- Mark all read only touches the caller's workspace ---
    await call('POST', '/tasks/mark-all-read');
    assert.ok(!(await memory.getTask('t-owner')).read, 'owner task not marked read by the new workspace');
    assert.ok((await memory.getTask('t-new')).read);
    console.log('✓ mark-all-read only affects the caller\'s own tasks');

    // --- Live activity stream ---
    const received = await new Promise((resolve, reject) => {
      const got = [];
      const req = http.get(`${base}/events/stream`, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          for (const line of chunk.split('\n')) if (line.startsWith('data: ')) got.push(JSON.parse(line.slice(6)).actor);
        });
        setTimeout(async () => {
          await activityLog.record('owner-live', 'step', 'x', { workspaceId: OWNER_WS });
          await activityLog.record('legacy-live', 'step', 'x', { scope: 'system', systemCaller: 'test' });
          await activityLog.record('new-live', 'step', 'x', { workspaceId: NEW_WS });
          setTimeout(() => { req.destroy(); resolve(got); }, 150);
        }, 100);
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    });
    assert.deepStrictEqual(received, ['new-live'], `live stream must carry only the caller's events, got ${JSON.stringify(received)}`);
    console.log('✓ live activity stream only carries the caller\'s own events');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\nAll legacy-visibility checks passed.');
}

main().catch((err) => {
  console.error('✗ workspace-legacy-visibility.test.js failed:', err);
  process.exit(1);
});
