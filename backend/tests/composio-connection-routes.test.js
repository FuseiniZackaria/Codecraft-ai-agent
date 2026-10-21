const assert = require('assert');
const express = require('express');

process.env.APP_OWNER_EMAIL = 'owner@example.com';

const config = require('../config');
const composio = require('../core/composio');
const connections = require('../core/workspaceConnections');
const connectionRoutes = require('../api/connectionRoutes');

const WS_OWNER = '00000000-0000-0000-0000-00000000000a';
const WS_ALICE = '00000000-0000-0000-0000-0000000000a1';

// Records every call so each case can assert what the route did (and did not) ask Composio for.
const calls = { start: [], findWs: [], findLegacy: [] };
let wsAccount = null; // what findWorkspaceAccount returns
let legacyAccount = { id: 'ca_legacy', userId: 'legacy-user' };

composio.startWorkspaceConnection = async (ws, toolkit, cb) => {
  calls.start.push({ ws, toolkit, cb });
  return { redirectUrl: 'https://connect.example/r', connectionId: 'ca_pending' };
};
composio.findWorkspaceAccount = async (ws, toolkit, connectionId) => {
  calls.findWs.push({ ws, toolkit, connectionId });
  return wsAccount;
};
composio.findLegacyAccount = async (toolkit) => {
  calls.findLegacy.push(toolkit);
  return legacyAccount;
};

function reset() {
  calls.start.length = 0;
  calls.findWs.length = 0;
  calls.findLegacy.length = 0;
  wsAccount = null;
  legacyAccount = { id: 'ca_legacy', userId: 'legacy-user' };
}

async function main() {
  config.composio.apiKey = 'test-composio-key';

  let user = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/connections', connectionRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/connections`;

  const post = async (path, body = {}) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const get = async (path) => {
    const res = await fetch(`${base}${path}`);
    return { status: res.status, body: await res.json() };
  };

  try {
    const alice = { id: 'u-alice', email: 'alice@example.com', workspaceId: WS_ALICE };
    const owner = { id: 'u-owner', email: 'owner@example.com', workspaceId: WS_OWNER };

    // --- Flag OFF (default): non-owner stays locked out ---
    config.composio.perWorkspace = false;
    user = alice;
    let r = await post('/gmail/connect');
    assert.strictEqual(r.status, 403);
    r = await post('/gmail/check', { connectionId: 'ca_x' });
    assert.strictEqual(r.status, 403);
    r = await get('/');
    assert.ok(r.body.connections.gmail.upgradeNotice, 'locked workspaces still see the coming-soon notice');
    assert.strictEqual(calls.start.length + calls.findWs.length + calls.findLegacy.length, 0, 'a locked workspace must not reach Composio at all');
    console.log('✓ flag off: non-owner connect/check are 403 and never reach Composio');

    // --- Flag ON: non-owner connects their own account ---
    config.composio.perWorkspace = true;
    reset();
    r = await post('/gmail/connect', {});
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.redirectUrl, 'https://connect.example/r');
    assert.strictEqual(r.body.connectionId, 'ca_pending');
    assert.strictEqual(calls.start[0].ws, WS_ALICE, 'sign-in is started under the caller\'s own workspace');
    assert.strictEqual(calls.findLegacy.length, 0, 'a non-owner must never be offered the legacy account');
    console.log('✓ flag on: non-owner starts a sign-in under their own workspace, legacy account never touched');

    // Not signed in yet -> pending, and the legacy account must not be adopted instead.
    reset();
    r = await post('/gmail/check', { connectionId: 'ca_pending' });
    assert.deepStrictEqual(r.body, { ok: false, status: 'pending' });
    assert.strictEqual(calls.findLegacy.length, 0, 'a non-owner must never adopt the legacy account');
    assert.strictEqual(await connections.getConnection(WS_ALICE, 'gmail'), null, 'nothing is stored until the account is verified');
    console.log('✓ check: unverified connection id stores nothing and never adopts the legacy account');

    // Signed in -> stored with the workspace as Composio user.
    reset();
    wsAccount = { id: 'ca_alice', userId: WS_ALICE, email: 'alice@gmail.com' };
    r = await post('/gmail/check', { connectionId: 'ca_alice' });
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(calls.findWs[0].connectionId, 'ca_alice');
    const row = await connections.getConnection(WS_ALICE, 'gmail');
    assert.strictEqual(row.composio_account_id, 'ca_alice');
    assert.strictEqual(row.provider_meta.composio_user_id, WS_ALICE);
    assert.strictEqual(row.status, 'connected');
    assert.strictEqual(row.connected_email, 'alice@gmail.com');
    console.log('✓ check: a verified workspace account is stored with its Composio user id');

    // --- Owner adopts the server's existing connection instead of signing in again ---
    reset();
    user = owner;
    r = await post('/gmail/connect', {});
    assert.strictEqual(r.body.adopted, true);
    assert.strictEqual(calls.start.length, 0);
    const ownerRow = await connections.getConnection(WS_OWNER, 'gmail');
    assert.strictEqual(ownerRow.composio_account_id, 'ca_legacy');
    assert.strictEqual(ownerRow.provider_meta.composio_user_id, 'legacy-user');
    console.log('✓ owner: existing server connection is adopted with its legacy user id');

    // Owner with nothing legacy -> normal sign-in under their workspace.
    reset();
    legacyAccount = null;
    await connections.deleteConnection(WS_OWNER, 'gmail');
    r = await post('/gmail/connect', {});
    assert.strictEqual(r.body.redirectUrl, 'https://connect.example/r');
    assert.strictEqual(calls.start[0].ws, WS_OWNER);
    console.log('✓ owner without a legacy connection signs in under their own workspace');

    // Owner check with a sign-in in flight must not swap in the legacy account.
    reset();
    legacyAccount = { id: 'ca_legacy', userId: 'legacy-user' };
    r = await post('/gmail/check', { connectionId: 'ca_pending' });
    assert.deepStrictEqual(r.body, { ok: false, status: 'pending' });
    assert.strictEqual(calls.findLegacy.length, 0);
    console.log('✓ owner: a pending sign-in is not replaced by the legacy account');
  } finally {
    config.composio.perWorkspace = false;
    server.close();
  }

  console.log('\nAll Composio connection route checks passed.');
}

main().catch((err) => {
  console.error('✗ composio-connection-routes.test.js failed:', err);
  process.exit(1);
});
