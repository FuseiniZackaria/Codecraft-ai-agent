const assert = require('assert');
const express = require('express');

const config = require('../config');
const composio = require('../core/composio');
const connections = require('../core/workspaceConnections');
const workspaceContext = require('../core/workspaceContext');
const connectionRoutes = require('../api/connectionRoutes');

const WS_OWNER = '00000000-0000-0000-0000-00000000000a';
const WS_B = '00000000-0000-0000-0000-0000000000b2';

workspaceContext.getAppOwnerWorkspaceId = async () => WS_OWNER;

// Stub the Composio calls the routes make, recording each one.
const calls = { start: [], findWs: [], findLegacy: [], identity: [], revoke: [] };
let wsAccount = null;
const LEGACY = { id: 'ca_owner_gmail', userId: 'legacy-user' };

composio.startWorkspaceConnection = async (ws, toolkit, cb) => {
  calls.start.push({ ws, toolkit, cb, entity: composio.entityFor(ws) });
  return { redirectUrl: 'https://connect.example/r', connectionId: 'ca_pending' };
};
composio.findWorkspaceAccount = async (ws, toolkit, connectionId) => { calls.findWs.push({ ws, connectionId }); return wsAccount; };
composio.findLegacyAccount = async (toolkit) => { calls.findLegacy.push(toolkit); return LEGACY; };
composio.fetchAccountIdentity = async (toolkit, acct) => { calls.identity.push(acct.id); return acct.id === LEGACY.id ? 'owner@gmail.com' : 'b-user@gmail.com'; };
const realRevoke = composio.revokeWorkspaceAccount;
composio.revokeWorkspaceAccount = async (ws, conn) => { calls.revoke.push(conn?.composio_account_id); return realRevoke.call(composio, ws, conn).catch(() => false); };
composio._resetForTests({ connectedAccounts: { delete: async () => ({}) } });

function reset() { for (const k of Object.keys(calls)) calls[k].length = 0; wsAccount = null; }

async function main() {
  config.composio.apiKey = 'test-composio-key';
  config.composio.userId = 'legacy-user';

  let user = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/connections', connectionRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/connections`;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };

  try {
    const userB = { id: 'u-b', email: 'dumenuian123@gmail.com', workspaceId: WS_B };
    const owner = { id: 'u-owner', email: 'owner@example.com', workspaceId: WS_OWNER };

    // --- The reported bug: B has a stale row pointing at the owner's account ---
    await connections.upsertConnection(WS_B, 'gmail', { composio_account_id: LEGACY.id, status: 'connected', connected_email: 'owner@gmail.com' });
    user = userB;
    reset();
    let r = await call('GET', '/');
    assert.strictEqual(r.body.connections.gmail.status, 'not_connected', 'B must not see the owner\'s connection');
    assert.strictEqual(await connections.getConnection(WS_B, 'gmail'), null, 'the stale row is removed');
    assert.strictEqual(calls.findLegacy.length, 0, 'B never looks at the legacy (.env) account');
    assert.strictEqual(calls.revoke.length, 0, 'cleanup never revokes anything at Composio');
    console.log('✓ B\'s stale row pointing at the owner\'s account is reported not connected and removed (nothing revoked)');

    r = await call('GET', '/gmail/status');
    assert.strictEqual(r.body.status, 'not_connected');
    console.log('✓ status check for B is not connected');

    // --- B clicking Connect must start OAuth, never say connected instantly ---
    reset();
    r = await call('POST', '/gmail/connect', {});
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body.adopted, 'connect must never adopt an existing account');
    assert.strictEqual(r.body.redirectUrl, 'https://connect.example/r', 'connect must hand back an OAuth redirect');
    assert.strictEqual(calls.start[0].entity, `ws_${WS_B}`);
    assert.strictEqual(calls.findLegacy.length, 0);
    console.log('✓ B clicking Connect starts a fresh OAuth flow under ws_<B>');

    // After sign-in Composio returns the browser to the app's Connections page
    // (which finishes the connection) - only the app's own origins are allowed.
    config.cors.allowedOrigins = ['https://app.example'];
    reset();
    await call('POST', '/gmail/connect', { redirectUrl: 'https://app.example/connections?connected=gmail' });
    assert.strictEqual(calls.start[0].cb, 'https://app.example/connections?connected=gmail');
    reset();
    await call('POST', '/gmail/connect', { redirectUrl: 'https://evil.example/steal' });
    assert.strictEqual(calls.start[0].cb, 'https://app.example/connections?connected=gmail', 'foreign redirect is replaced');
    reset();
    await call('POST', '/gmail/connect', {});
    assert.strictEqual(calls.start[0].cb, 'https://app.example/connections?connected=gmail', 'default returns to the Connections page');
    console.log('✓ sign-in returns to the app\'s Connections page; foreign redirect URLs are refused');

    // Before sign-in completes: pending, nothing stored, no legacy fallback.
    reset();
    r = await call('POST', '/gmail/check', { connectionId: 'ca_pending' });
    assert.deepStrictEqual(r.body, { ok: false, status: 'pending' });
    assert.strictEqual(await connections.getConnection(WS_B, 'gmail'), null);
    assert.strictEqual(calls.findLegacy.length, 0);
    console.log('✓ check before sign-in stays pending and stores nothing');

    // After sign-in: stored under B's entity, with B's own address on the card.
    reset();
    wsAccount = { id: 'ca_b_gmail', userId: `ws_${WS_B}` };
    r = await call('POST', '/gmail/check', { connectionId: 'ca_b_gmail' });
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.connected_email, 'b-user@gmail.com');
    r = await call('GET', '/');
    assert.strictEqual(r.body.connections.gmail.status, 'connected');
    assert.strictEqual(r.body.connections.gmail.connected_email, 'b-user@gmail.com', 'the card shows B\'s own account');
    assert.strictEqual(r.body.connections.gmail.composio_account_id, 'ca_b_gmail');
    console.log('✓ after sign-in B is connected to its own account, and the card shows its address');

    // --- Owner: existing connection mapped to the owner workspace, no reconnect ---
    user = owner;
    reset();
    r = await call('GET', '/');
    assert.strictEqual(r.body.connections.gmail.status, 'connected');
    assert.strictEqual(r.body.connections.gmail.connected_email, 'owner@gmail.com');
    const ownerRow = await connections.getConnection(WS_OWNER, 'gmail');
    assert.strictEqual(ownerRow.provider_meta.composio_user_id, 'legacy-user');
    console.log('✓ owner keeps the existing Gmail without reconnecting (mapped to the owner workspace)');

    // B still only sees its own.
    user = userB;
    r = await call('GET', '/');
    assert.strictEqual(r.body.connections.gmail.connected_email, 'b-user@gmail.com');
    assert.strictEqual(r.body.connections.googlecalendar.status, 'not_connected', 'B never inherits the owner\'s calendar');
    console.log('✓ B never sees the owner\'s connections');

    // --- Disconnect: only the caller's own row; owner's account never revoked ---
    reset();
    r = await call('DELETE', '/gmail');
    assert.strictEqual(r.body.revoked, true, 'B\'s own account is revoked');
    assert.strictEqual(await connections.getConnection(WS_B, 'gmail'), null);
    assert.ok(await connections.getConnection(WS_OWNER, 'gmail'), 'the owner\'s connection is untouched');

    user = owner;
    r = await call('DELETE', '/gmail');
    assert.strictEqual(r.body.revoked, false, 'the owner\'s legacy account is never revoked by Disconnect');
    console.log('✓ Disconnect removes only the caller\'s own connection; the legacy account is never revoked');

    // --- Owner reconnect (expired legacy token): after Disconnect the legacy
    // account is NOT re-attached, so the card offers Connect and OAuth runs. ---
    reset();
    r = await call('GET', '/');
    assert.strictEqual(r.body.connections.gmail.status, 'not_connected', 'disconnected legacy account must not come back');
    assert.strictEqual(calls.findLegacy.length, 0, 'the legacy account is not looked up again');
    r = await call('POST', '/gmail/connect', {});
    assert.strictEqual(calls.start[0].entity, `ws_${WS_OWNER}`, 'owner reconnects under their own workspace entity');
    wsAccount = { id: 'ca_owner_new', userId: `ws_${WS_OWNER}` };
    r = await call('POST', '/gmail/check', { connectionId: 'ca_owner_new' });
    assert.strictEqual(r.body.ok, true);
    const fresh = await connections.getConnection(WS_OWNER, 'gmail');
    assert.strictEqual(fresh.composio_account_id, 'ca_owner_new');
    assert.strictEqual(fresh.provider_meta.composio_user_id, `ws_${WS_OWNER}`);
    assert.ok(!fresh.provider_meta.legacy_dismissed);
    r = await call('GET', '/');
    assert.strictEqual(r.body.connections.gmail.status, 'connected');
    console.log('✓ owner can reconnect after an expired token: Disconnect -> Connect -> new account under ws_<owner>');
  } finally {
    server.close();
  }

  console.log('\nAll Composio connection route checks passed.');
}

main().catch((err) => {
  console.error('✗ composio-connection-routes.test.js failed:', err);
  process.exit(1);
});
