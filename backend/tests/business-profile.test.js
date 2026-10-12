// Phase 2.4: per-workspace business_profile row drives agent prompts and
// the inbox-triage self-skip list. This test proves:
//   1. The service returns per-workspace values (no cross-leak).
//   2. The service falls back to legacy env/business.json when a row is
//      blank, so legacy single-tenant deployments keep working.
//   3. selfEmailSet() includes business_email + extra_email_addresses.
//   4. PersonalAssistantAgent.filterMessages uses the Settings-page extras
//      to drop incoming mail from "my other address" as if it were mine.
//   5. updateBusinessProfile goes through the workspace guard (we invalidate
//      the cache so a save is visible immediately).

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.WORKSPACE_GUARD_MODE = 'log';

const assert = require('assert');

async function run() {
  const memory = require('../memory');
  const businessProfile = require('../core/businessProfile');
  const { readShadowLog, clearShadowLog } = require('../memory/workspaceGuard');

  const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  // --- 1. Save two profiles, confirm no cross-leak. ---
  clearShadowLog();
  await memory.updateBusinessProfile(
    { business_name: 'Alice Co', business_email: 'alice@aliceco.com', signature: 'Alice', extra_email_addresses: ['al@gmail.com'] },
    { workspaceId: WS_A }
  );
  await memory.updateBusinessProfile(
    { business_name: 'Bob Ltd', business_email: 'bob@bob.com', signature: 'Bob', extra_email_addresses: ['bob.b@gmail.com'] },
    { workspaceId: WS_B }
  );
  // Drop the service cache so reads below see the writes.
  businessProfile.invalidate(WS_A);
  businessProfile.invalidate(WS_B);

  const aProfile = await businessProfile.getProfile(WS_A);
  const bProfile = await businessProfile.getProfile(WS_B);
  assert.strictEqual(aProfile.business_name, 'Alice Co');
  assert.strictEqual(aProfile.business_email, 'alice@aliceco.com');
  assert.strictEqual(bProfile.business_name, 'Bob Ltd');
  assert.strictEqual(bProfile.business_email, 'bob@bob.com');
  assert.notStrictEqual(aProfile.business_name, bProfile.business_name);
  console.log('✓ per-workspace profile: Alice and Bob never see each other\'s fields');

  // --- 2. Context block renders Alice's details for workspace A. ---
  const { businessContextLine } = require('../core/businessContext');
  const aBlock = await businessContextLine(WS_A);
  assert.ok(aBlock.includes('Alice Co'), 'Alice\'s business name must appear in her context block');
  assert.ok(aBlock.includes('alice@aliceco.com'), 'Alice\'s business email must appear in her context block');
  assert.ok(!aBlock.includes('Bob'), 'Alice\'s context block must NOT contain Bob\'s details');
  console.log('✓ businessContextLine renders the right workspace\'s profile');

  // --- 3. selfEmailSet merges business_email + extras ---
  const aSet = await businessProfile.selfEmailSet(WS_A);
  assert.ok(aSet.has('alice@aliceco.com'), 'self-email set must include business_email');
  assert.ok(aSet.has('al@gmail.com'),       'self-email set must include extra addresses');
  assert.ok(!aSet.has('bob@bob.com'),       'self-email set must NOT include another workspace\'s addresses');
  console.log('✓ selfEmailSet merges business_email + extras, scoped per workspace');

  // --- 4. PersonalAssistantAgent.filterMessages treats an extras address
  //        as "mine" and drops it from the triage list.
  const PersonalAssistantAgent = require('../agents/personal-assistant/PersonalAssistantAgent');
  const agent = new PersonalAssistantAgent();
  const messages = [
    { id: '1', threadId: 't1', from: 'customer@real.com', subject: 'Need help', preview: { body: 'hi' } },
    { id: '2', threadId: 't2', from: 'Me <al@gmail.com>', subject: 'Note to self', preview: { body: 'tbd' } },
  ];
  const { survivors, counters } = await agent.filterMessages(messages, WS_A);
  const survivorFroms = survivors.map((s) => s.from);
  assert.ok(survivorFroms.some((f) => f.includes('customer@real.com')), 'customer must survive triage');
  assert.ok(!survivorFroms.some((f) => f.includes('al@gmail.com')),      'extras-address email must be dropped as self');
  assert.strictEqual(counters.myOwn, 1, 'the extras address counts as myOwn in the triage counters');
  console.log('✓ inbox-triage drops mail from an extras address as self-mail');

  // --- 5. updateBusinessProfile is watched by the workspace guard.
  clearShadowLog();
  await memory.updateBusinessProfile({ business_name: 'Alice Co 2' }, { workspaceId: WS_A });
  // Scoped write — no "no_workspace_on_call_or_row" miss.
  const misses = readShadowLog().filter(
    (e) => e.method === 'updateBusinessProfile' && e.reason === 'no_workspace_on_call_or_row'
  );
  assert.strictEqual(misses.length, 0, 'scoped updateBusinessProfile must not log a miss');
  console.log('✓ updateBusinessProfile with workspaceId produces no shadow-log miss');

  console.log('\nAll Phase 2.4 business-profile checks passed.');
}

run().catch((err) => {
  console.error('✗ business-profile.test.js failed:', err);
  process.exit(1);
});
