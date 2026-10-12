// Phase 2.5: per-workspace connections tests.
//   1. Per-workspace isolation: workspace A's connection is never visible to workspace B.
//   2. No cross-workspace fallback: looking up a connection for workspace B returns null, not A's.
//   3. Webhook routing by token: findConnectionByWebhookToken returns the right workspace.
//   4. Telegram token verification via encrypt/decrypt round-trip.
//   5. upsertWorkspaceConnection goes through the workspace guard with no miss.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = 'test-key-for-encryption-only';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.WORKSPACE_GUARD_MODE = 'log';

const assert = require('assert');

async function run() {
  const memory = require('../memory');
  const connections = require('../core/workspaceConnections');
  const { readShadowLog, clearShadowLog } = require('../memory/workspaceGuard');

  const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  // --- 1. Per-workspace isolation ---
  clearShadowLog();

  await connections.upsertConnection(WS_A, 'telegram', {
    provider_meta: {
      encrypted_token: connections.encrypt('bot-token-alice'),
      webhook_token: 'wh-token-alice',
      bot_username: 'alice_bot',
    },
    status: 'connected',
  });

  await connections.upsertConnection(WS_B, 'telegram', {
    provider_meta: {
      encrypted_token: connections.encrypt('bot-token-bob'),
      webhook_token: 'wh-token-bob',
      bot_username: 'bob_bot',
    },
    status: 'connected',
  });

  const aliceTg = await connections.getConnection(WS_A, 'telegram');
  const bobTg = await connections.getConnection(WS_B, 'telegram');
  assert.strictEqual(aliceTg.provider_meta.bot_username, 'alice_bot');
  assert.strictEqual(bobTg.provider_meta.bot_username, 'bob_bot');
  assert.notStrictEqual(aliceTg.provider_meta.webhook_token, bobTg.provider_meta.webhook_token);
  console.log('✓ per-workspace isolation: Alice and Bob have separate Telegram connections');

  // --- 2. No cross-workspace fallback ---
  const noConn = await connections.getConnection(WS_A, 'whatsapp');
  assert.strictEqual(noConn, null, 'Looking up a provider not connected should return null');

  const aliceList = await connections.listConnections(WS_A);
  assert.strictEqual(aliceList.length, 1, 'Alice has exactly 1 connection');
  assert.ok(!aliceList.some((c) => c.provider_meta?.bot_username === 'bob_bot'), 'Alice must never see Bob\'s connection');
  console.log('✓ no cross-workspace fallback: missing provider returns null, lists are scoped');

  // --- 3. Webhook routing by token ---
  const routedAlice = await connections.findByWebhookToken('telegram', 'wh-token-alice');
  assert.ok(routedAlice, 'webhook token alice must resolve');
  assert.strictEqual(routedAlice.workspace_id, WS_A);
  assert.strictEqual(routedAlice.provider_meta.bot_username, 'alice_bot');

  const routedBob = await connections.findByWebhookToken('telegram', 'wh-token-bob');
  assert.ok(routedBob, 'webhook token bob must resolve');
  assert.strictEqual(routedBob.workspace_id, WS_B);

  const routedNone = await connections.findByWebhookToken('telegram', 'nonexistent-token');
  assert.strictEqual(routedNone, null, 'unknown webhook token must return null');
  console.log('✓ webhook routing by token resolves the correct workspace');

  // --- 4. Encrypt/decrypt round-trip ---
  const secret = 'super-secret-bot-token-12345';
  const encrypted = connections.encrypt(secret);
  assert.ok(encrypted.iv, 'encrypted has iv');
  assert.ok(encrypted.tag, 'encrypted has tag');
  assert.ok(encrypted.enc, 'encrypted has ciphertext');
  assert.notStrictEqual(encrypted.enc, secret, 'ciphertext must not equal plaintext');

  const decrypted = connections.decrypt(encrypted);
  assert.strictEqual(decrypted, secret, 'decrypt must recover the original plaintext');

  // Verify the stored token also decrypts
  const aliceDecrypted = connections.decrypt(aliceTg.provider_meta.encrypted_token);
  assert.strictEqual(aliceDecrypted, 'bot-token-alice');
  console.log('✓ encrypt/decrypt round-trip works for bot tokens');

  // --- 5. Guard sees no shadow-log miss for scoped upsert ---
  clearShadowLog();
  await connections.upsertConnection(WS_A, 'whatsapp', {
    provider_meta: { type: 'twilio', account_sid: 'AC123' },
    status: 'connected',
  });
  const misses = readShadowLog().filter(
    (e) => e.method === 'upsertWorkspaceConnection' && e.reason === 'no_workspace_on_call_or_row'
  );
  assert.strictEqual(misses.length, 0, 'scoped upsertWorkspaceConnection must not log a miss');
  console.log('✓ upsertWorkspaceConnection with workspaceId produces no shadow-log miss');

  // --- 6. Delete removes connection ---
  await connections.deleteConnection(WS_A, 'whatsapp');
  const deleted = await connections.getConnection(WS_A, 'whatsapp');
  assert.strictEqual(deleted, null, 'deleted connection must return null');
  console.log('✓ deleteConnection removes the connection');

  // --- 7. safeConnectionView never exposes encrypted tokens ---
  const safe = connections.safeConnectionView(aliceTg);
  assert.ok(!JSON.stringify(safe).includes('bot-token-alice'), 'safe view must not contain the plaintext token');
  assert.ok(!JSON.stringify(safe).includes('encrypted_token'), 'safe view must not contain the encrypted_token object');
  assert.strictEqual(safe.bot_username, 'alice_bot', 'safe view includes bot_username');
  console.log('✓ safeConnectionView never exposes encrypted tokens');

  console.log('\nAll Phase 2.5 workspace-connections checks passed.');
}

run().catch((err) => {
  console.error('✗ workspace-connections.test.js failed:', err);
  process.exit(1);
});
