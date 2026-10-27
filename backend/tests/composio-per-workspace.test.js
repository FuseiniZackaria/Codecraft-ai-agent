const assert = require('assert');

const config = require('../config');
const composio = require('../core/composio');
const connections = require('../core/workspaceConnections');
const workspaceContext = require('../core/workspaceContext');

const OWNER_WS = '00000000-0000-0000-0000-00000000000a';
const WS_ALICE = '00000000-0000-0000-0000-0000000000a1';
const WS_BOB = '00000000-0000-0000-0000-0000000000b2';

function fakeClient({ listItems = [] } = {}) {
  const calls = { execute: [], list: [], link: [], authCreate: [], del: [] };
  return {
    calls,
    toolkits: { get: async () => ({ meta: { availableVersions: ['20250101_00'] } }) },
    tools: {
      execute: async (slug, params) => {
        calls.execute.push({ slug, params });
        return { successful: true, data: { emailAddress: 'someone@gmail.com' } };
      },
    },
    connectedAccounts: {
      list: async (query) => { calls.list.push(query); return { items: listItems }; },
      link: async (userId, authConfigId, options) => {
        calls.link.push({ userId, authConfigId, options });
        return { id: 'ca_pending_1', redirectUrl: 'https://connect.example/redirect' };
      },
      delete: async (id) => { calls.del.push(id); return { success: true }; },
    },
    authConfigs: {
      list: async () => ({ items: [] }),
      create: async (toolkit, options) => { calls.authCreate.push({ toolkit, options }); return { id: 'ac_managed_1' }; },
    },
  };
}

async function main() {
  config.composio.apiKey = 'test-composio-key';
  config.composio.userId = 'legacy-user';
  config.composio.connectedAccountIds.gmail = 'ca_legacy_gmail'; // the owner's pinned .env account

  let client = fakeClient();
  composio._resetForTests(client);
  workspaceContext.getAppOwnerWorkspaceId = async () => OWNER_WS;

  assert.strictEqual(composio.entityFor(WS_ALICE), `ws_${WS_ALICE}`);
  assert.notStrictEqual(composio.entityFor(WS_ALICE), composio.entityFor(WS_BOB));
  console.log('✓ every workspace has its own Composio entity (ws_<workspace_id>)');

  // --- No connection: refused with "Connect Gmail first", .env id never used ---
  await assert.rejects(
    () => composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: WS_ALICE }),
    (err) => err instanceof composio.WorkspaceConnectionError && /Connect Gmail first/.test(err.message)
  );
  assert.strictEqual(client.calls.execute.length, 0, 'nothing may run, and the .env account is never touched');
  console.log('✓ a user workspace with no connection is blocked with "Connect Gmail first" (no .env fallback)');

  // --- The exact bug: a row "adopted" from the owner's account is NOT trusted ---
  await connections.upsertConnection(WS_BOB, 'gmail', { composio_account_id: 'ca_legacy_gmail', status: 'connected' });
  await assert.rejects(() => composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: WS_BOB }), composio.WorkspaceConnectionError);
  await connections.upsertConnection(WS_BOB, 'gmail', {
    composio_account_id: 'ca_legacy_gmail', provider_meta: { composio_user_id: 'legacy-user' }, status: 'connected',
  });
  await assert.rejects(() => composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: WS_BOB }), composio.WorkspaceConnectionError,
    'a non-owner row pointing at the legacy (.env) user must be refused');
  await connections.upsertConnection(WS_BOB, 'gmail', {
    composio_account_id: 'ca_alice', provider_meta: { composio_user_id: composio.entityFor(WS_ALICE) }, status: 'connected',
  });
  await assert.rejects(() => composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: WS_BOB }), composio.WorkspaceConnectionError,
    'a row pointing at another workspace\'s entity must be refused');
  assert.strictEqual(client.calls.execute.length, 0);
  console.log('✓ stale rows (adopted owner account, legacy user, another workspace\'s entity) are never used');

  // --- A verified own connection is used, under the workspace's own entity ---
  await connections.upsertConnection(WS_ALICE, 'gmail', {
    composio_account_id: 'ca_alice', provider_meta: { composio_user_id: composio.entityFor(WS_ALICE) }, status: 'connected',
  });
  await composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: WS_ALICE });
  assert.strictEqual(client.calls.execute[0].params.connectedAccountId, 'ca_alice');
  assert.strictEqual(client.calls.execute[0].params.userId, `ws_${WS_ALICE}`);
  console.log('✓ a workspace runs only on its own verified account and entity');

  // --- Owner workspace keeps working on its mapped legacy account ---
  client.calls.execute.length = 0;
  await composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: OWNER_WS });
  assert.strictEqual(client.calls.execute[0].params.connectedAccountId, 'ca_legacy_gmail');
  assert.strictEqual(client.calls.execute[0].params.userId, 'legacy-user');
  await connections.upsertConnection(OWNER_WS, 'gmail', {
    composio_account_id: 'ca_legacy_gmail', provider_meta: { composio_user_id: 'legacy-user' }, status: 'connected',
  });
  await composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: OWNER_WS });
  assert.strictEqual(client.calls.execute[1].params.connectedAccountId, 'ca_legacy_gmail');
  console.log('✓ owner workspace keeps its existing connection (legacy account mapped to the owner only)');

  // Owner disconnected the (expired) legacy account: no silent fallback to it.
  await connections.upsertConnection(OWNER_WS, 'gmail', {
    composio_account_id: null, provider_meta: { legacy_dismissed: true }, status: 'disconnected',
  });
  await assert.rejects(
    () => composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: OWNER_WS }),
    (err) => /Connect Gmail first/.test(err.message)
  );
  console.log('✓ after the owner disconnects the legacy account it is not used again until they reconnect');

  // --- YouTube / Reddit have one server account: owner only ---
  await assert.rejects(
    () => composio.execute('YOUTUBE_SEARCH_YOU_TUBE', {}, 'youtube', { workspaceId: WS_ALICE }),
    (err) => err instanceof composio.WorkspaceConnectionError && /not available for this workspace/.test(err.message)
  );
  console.log('✓ youtube/reddit are refused for non-owner workspaces');

  // --- Claiming: only accounts under the workspace's own entity ---
  client = fakeClient({
    listItems: [
      { id: 'ca_alice_active', status: 'ACTIVE', toolkit: { slug: 'gmail' } },
      { id: 'ca_wrong_toolkit', status: 'ACTIVE', toolkit: { slug: 'github' } },
      { id: 'ca_inactive', status: 'INITIATED', toolkit: { slug: 'gmail' } },
      { id: 'ca_someone_elses', status: 'ACTIVE', toolkit: { slug: 'gmail' }, userId: `ws_${WS_BOB}` },
    ],
  });
  composio._resetForTests(client);
  const found = await composio.findWorkspaceAccount(WS_ALICE, 'gmail');
  assert.strictEqual(found.id, 'ca_alice_active');
  assert.strictEqual(found.userId, `ws_${WS_ALICE}`);
  assert.deepStrictEqual(client.calls.list[0].userIds, [`ws_${WS_ALICE}`], 'lookup is filtered to the workspace entity only');
  for (const id of ['ca_someone_elses', 'ca_not_in_my_list', 'ca_wrong_toolkit', 'ca_inactive']) {
    assert.strictEqual(await composio.findWorkspaceAccount(WS_ALICE, 'gmail', id), null, `${id} must not be claimable`);
  }
  console.log('✓ a workspace cannot claim another entity\'s, another toolkit\'s, or an inactive account');

  // --- Connect always starts a fresh OAuth flow under the workspace entity ---
  const started = await composio.startWorkspaceConnection(WS_BOB, 'gmail', 'https://app.example/cb');
  assert.strictEqual(client.calls.link[0].userId, `ws_${WS_BOB}`);
  assert.strictEqual(client.calls.authCreate[0].options.type, 'use_composio_managed_auth');
  assert.strictEqual(client.calls.link[0].options.callbackUrl, 'https://app.example/cb');
  assert.strictEqual(client.calls.link[0].options.allowMultiple, true, 'a reconnect is not blocked by the old account');
  assert.strictEqual(started.redirectUrl, 'https://connect.example/redirect');
  console.log('✓ connect starts a fresh OAuth flow under the workspace\'s own entity');

  // A failing auth config falls through to the next one; when all fail the
  // real Composio reason is shown (not just "Failed to create connected account link").
  const linkErr = (msg) => Object.assign(new Error('Failed to create connected account link'), { cause: { error: { error: { message: msg } } } });
  const fallback = fakeClient();
  fallback.authConfigs.list = async () => ({ items: [
    { id: 'ac_custom', toolkit: { slug: 'gmail' }, status: 'ENABLED', isComposioManaged: false },
    { id: 'ac_disabled', toolkit: { slug: 'gmail' }, status: 'DISABLED', isComposioManaged: true },
    { id: 'ac_managed', toolkit: { slug: 'gmail' }, status: 'ENABLED', isComposioManaged: true },
  ] });
  fallback.connectedAccounts.link = async (userId, authConfigId, options) => {
    fallback.calls.link.push({ userId, authConfigId, options });
    if (authConfigId === 'ac_managed') throw linkErr('auth config is not enabled for link');
    return { id: 'ca_ok', redirectUrl: 'https://connect.example/ok' };
  };
  composio._resetForTests(fallback);
  const viaFallback = await composio.startWorkspaceConnection(WS_BOB, 'gmail', null);
  assert.deepStrictEqual(fallback.calls.link.map((c) => c.authConfigId), ['ac_managed', 'ac_custom'], 'managed first, disabled skipped, then the next one');
  assert.strictEqual(viaFallback.redirectUrl, 'https://connect.example/ok');

  const allFail = fakeClient();
  allFail.authConfigs.list = async () => ({ items: [{ id: 'ac_only', toolkit: { slug: 'gmail' }, status: 'ENABLED', isComposioManaged: true }] });
  allFail.connectedAccounts.link = async () => { throw linkErr('callback_url is not allowed'); };
  composio._resetForTests(allFail);
  await assert.rejects(() => composio.startWorkspaceConnection(WS_BOB, 'gmail', null), /callback_url is not allowed/);
  composio._resetForTests(client);
  console.log('✓ connect tries each enabled auth config and reports Composio\'s real error');

  // --- Identity for the card, read-only ---
  const identity = await composio.fetchAccountIdentity('gmail', found);
  assert.strictEqual(identity, 'someone@gmail.com');
  assert.strictEqual(client.calls.execute.at(-1).params.userId, `ws_${WS_ALICE}`);
  console.log('✓ the connected address is read from the workspace\'s own account');

  // --- Revoke only touches the workspace's own entity ---
  assert.strictEqual(await composio.revokeWorkspaceAccount(WS_ALICE, {
    composio_account_id: 'ca_alice', provider_meta: { composio_user_id: `ws_${WS_ALICE}` },
  }), true);
  assert.strictEqual(await composio.revokeWorkspaceAccount(OWNER_WS, {
    composio_account_id: 'ca_legacy_gmail', provider_meta: { composio_user_id: 'legacy-user' },
  }), false, 'the owner\'s legacy account is never revoked');
  assert.strictEqual(await composio.revokeWorkspaceAccount(WS_BOB, {
    composio_account_id: 'ca_alice', provider_meta: { composio_user_id: `ws_${WS_ALICE}` },
  }), false, 'another workspace\'s account is never revoked');
  assert.deepStrictEqual(client.calls.del, ['ca_alice']);
  console.log('✓ revoke only ever touches the workspace\'s own account');

  console.log('\nAll per-workspace Composio checks passed.');
}

main().catch((err) => {
  console.error('✗ composio-per-workspace.test.js failed:', err);
  process.exit(1);
});
