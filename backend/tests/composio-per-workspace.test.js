const assert = require('assert');

const config = require('../config');
const composio = require('../core/composio');
const connections = require('../core/workspaceConnections');
const workspaceContext = require('../core/workspaceContext');

const OWNER_WS = '00000000-0000-0000-0000-00000000000a';
const WS_ALICE = '00000000-0000-0000-0000-0000000000a1';
const WS_BOB = '00000000-0000-0000-0000-0000000000b2';

function fakeClient({ listItems = [] } = {}) {
  const calls = { execute: [], list: [], link: [], authList: [], authCreate: [] };
  return {
    calls,
    toolkits: { get: async () => ({ meta: { availableVersions: ['20250101_00'] } }) },
    tools: {
      execute: async (slug, params) => {
        calls.execute.push({ slug, params });
        return { successful: true, data: { ok: true } };
      },
    },
    connectedAccounts: {
      list: async (query) => { calls.list.push(query); return { items: listItems }; },
      link: async (userId, authConfigId, options) => {
        calls.link.push({ userId, authConfigId, options });
        return { id: 'ca_pending_1', redirectUrl: 'https://connect.example/redirect' };
      },
    },
    authConfigs: {
      list: async (query) => { calls.authList.push(query); return { items: [] }; },
      create: async (toolkit, options) => { calls.authCreate.push({ toolkit, options }); return { id: 'ac_managed_1' }; },
    },
  };
}

async function main() {
  config.composio.apiKey = 'test-composio-key';
  config.composio.userId = 'legacy-user';
  config.composio.connectedAccountIds.gmail = 'ca_legacy_gmail';

  let client = fakeClient();
  composio._resetForTests(client);

  // The app owner's workspace is OWNER_WS; Alice and Bob are ordinary workspaces.
  workspaceContext.getAppOwnerWorkspaceId = async () => OWNER_WS;

  // --- A workspace with no connection must never run on the owner's account ---
  await assert.rejects(
    () => composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: WS_ALICE }),
    (err) => err instanceof composio.WorkspaceConnectionError && /not connected for this workspace/.test(err.message),
    'a non-owner workspace without its own Gmail must be refused, not fall back to the .env account'
  );
  assert.strictEqual(client.calls.execute.length, 0, 'nothing may be executed for the refused call');
  console.log('✓ non-owner workspace with no connection is refused (no fallback to the owner account)');

  // --- Each workspace runs on its own connected account ---
  await connections.upsertConnection(WS_ALICE, 'gmail', { composio_account_id: 'ca_alice', status: 'connected' });
  await connections.upsertConnection(WS_BOB, 'gmail', { composio_account_id: 'ca_bob', status: 'connected' });

  await composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: WS_ALICE });
  await composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: WS_BOB });
  assert.strictEqual(client.calls.execute[0].params.connectedAccountId, 'ca_alice');
  assert.strictEqual(client.calls.execute[0].params.userId, WS_ALICE, 'link-flow accounts belong to the workspace id user');
  assert.strictEqual(client.calls.execute[1].params.connectedAccountId, 'ca_bob');
  assert.strictEqual(client.calls.execute[1].params.userId, WS_BOB);
  console.log('✓ each workspace executes on its own connected account and Composio user');

  // --- A disconnected / pending row does not count ---
  await connections.upsertConnection(WS_BOB, 'gmail', { composio_account_id: 'ca_bob', status: 'disconnected' });
  await assert.rejects(
    () => composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: WS_BOB }),
    composio.WorkspaceConnectionError
  );
  console.log('✓ a disconnected connection row is treated as not connected');

  // --- Toolkits with no per-workspace support are owner-only ---
  await assert.rejects(
    () => composio.execute('YOUTUBE_SEARCH_YOU_TUBE', {}, 'youtube', { workspaceId: WS_ALICE }),
    (err) => err instanceof composio.WorkspaceConnectionError && /not available for this workspace/.test(err.message)
  );
  console.log('✓ youtube/reddit (single server account) are refused for non-owner workspaces');

  // --- Owner workspace keeps working on the legacy account ---
  client.calls.execute.length = 0;
  await composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: OWNER_WS });
  assert.strictEqual(client.calls.execute[0].params.connectedAccountId, 'ca_legacy_gmail');
  assert.strictEqual(client.calls.execute[0].params.userId, 'legacy-user');
  console.log('✓ owner workspace without a row still uses the legacy .env account');

  // An account the owner adopted from the old dashboard flow stays under the legacy user id.
  await connections.upsertConnection(OWNER_WS, 'gmail', { composio_account_id: 'ca_owner_adopted', status: 'connected' });
  await composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail', { workspaceId: OWNER_WS });
  assert.strictEqual(client.calls.execute[1].params.connectedAccountId, 'ca_owner_adopted');
  assert.strictEqual(client.calls.execute[1].params.userId, 'legacy-user');
  console.log('✓ owner-adopted account keeps the legacy Composio user id');

  // --- No workspace (scheduler / webhook / legacy callers) behaves exactly as before ---
  await composio.execute('GMAIL_FETCH_EMAILS', {}, 'gmail');
  assert.strictEqual(client.calls.execute[2].params.connectedAccountId, 'ca_legacy_gmail');
  console.log('✓ calls with no workspace use the legacy account (unchanged behaviour)');

  // --- Claiming accounts: only the workspace's own Composio user counts ---
  client = fakeClient({
    listItems: [
      { id: 'ca_alice_active', status: 'ACTIVE', toolkit: { slug: 'gmail' } },
      { id: 'ca_wrong_toolkit', status: 'ACTIVE', toolkit: { slug: 'github' } },
      { id: 'ca_inactive', status: 'INITIATED', toolkit: { slug: 'gmail' } },
      { id: 'ca_someone_elses', status: 'ACTIVE', toolkit: { slug: 'gmail' }, userId: WS_BOB },
    ],
  });
  composio._resetForTests(client);

  const found = await composio.findWorkspaceAccount(WS_ALICE, 'gmail');
  assert.strictEqual(found.id, 'ca_alice_active');
  assert.strictEqual(found.userId, WS_ALICE);
  assert.deepStrictEqual(client.calls.list[0].userIds, [WS_ALICE], 'the lookup must be filtered to the workspace user');
  assert.deepStrictEqual(client.calls.list[0].toolkitSlugs, ['gmail']);
  console.log('✓ findWorkspaceAccount filters by the workspace user and toolkit');

  assert.strictEqual(await composio.findWorkspaceAccount(WS_ALICE, 'gmail', 'ca_someone_elses'), null,
    'a connection id that reports a different owner must be rejected');
  assert.strictEqual(await composio.findWorkspaceAccount(WS_ALICE, 'gmail', 'ca_not_in_my_list'), null,
    'a guessed connection id outside the workspace\'s own accounts must be rejected');
  assert.strictEqual(await composio.findWorkspaceAccount(WS_ALICE, 'gmail', 'ca_wrong_toolkit'), null,
    'an account for a different toolkit must be rejected');
  assert.strictEqual(await composio.findWorkspaceAccount(WS_ALICE, 'gmail', 'ca_inactive'), null,
    'an account that is not ACTIVE must be rejected');
  console.log('✓ a workspace cannot claim another workspace\'s, another toolkit\'s, or an inactive connection');

  // --- Starting the sign-in flow uses the workspace id as the Composio user ---
  const started = await composio.startWorkspaceConnection(WS_ALICE, 'gmail', 'https://app.example/cb');
  assert.strictEqual(client.calls.link[0].userId, WS_ALICE);
  assert.strictEqual(client.calls.link[0].authConfigId, 'ac_managed_1');
  assert.deepStrictEqual(client.calls.link[0].options, { callbackUrl: 'https://app.example/cb' });
  assert.strictEqual(client.calls.authCreate[0].options.type, 'use_composio_managed_auth');
  assert.strictEqual(started.redirectUrl, 'https://connect.example/redirect');
  assert.strictEqual(started.connectionId, 'ca_pending_1');
  await assert.rejects(() => composio.startWorkspaceConnection(WS_ALICE, 'youtube', null), /cannot be connected per workspace/);
  console.log('✓ startWorkspaceConnection links under the workspace id with a Composio-managed auth config');

  console.log('\nAll per-workspace Composio checks passed.');
}

main().catch((err) => {
  console.error('✗ composio-per-workspace.test.js failed:', err);
  process.exit(1);
});
