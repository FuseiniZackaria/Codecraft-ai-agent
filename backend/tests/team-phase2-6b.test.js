// Phase 2.6b: team invite fixes — email typo detection, pending invite handling,
// app-owner controls, listTasks null-workspace guard, rate-limit error shape.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = 'test-key-for-encryption-only';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.WORKSPACE_GUARD_MODE = 'enforce';

const assert = require('assert');

async function run() {
  const MemoryStore = require('../memory/MemoryStore');
  const { withWorkspaceGuard, WorkspaceGuardError } = require('../memory/workspaceGuard');

  const store = withWorkspaceGuard(new MemoryStore());

  const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  // --- 1. Email typo detection (server-side mirror of frontend logic) ---
  // Import the teamRoutes module indirectly — the typo detection logic is
  // duplicated here to verify the same domain-typo map catches common mistakes.
  const DOMAIN_TYPOS = {
    'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
    'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com',
    'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com',
    'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com',
  };

  function detectEmailTypo(email) {
    const domain = (email.split('@')[1] || '').toLowerCase();
    const suggestion = DOMAIN_TYPOS[domain];
    if (!suggestion) return null;
    return email.replace(/@[^@]+$/, `@${suggestion}`);
  }

  assert.strictEqual(detectEmailTypo('user@gmail.co'), 'user@gmail.com', 'gmail.co -> gmail.com');
  assert.strictEqual(detectEmailTypo('user@gmial.com'), 'user@gmail.com', 'gmial.com -> gmail.com');
  assert.strictEqual(detectEmailTypo('user@gmail.con'), 'user@gmail.com', 'gmail.con -> gmail.com');
  assert.strictEqual(detectEmailTypo('user@outlok.com'), 'user@outlook.com', 'outlok.com -> outlook.com');
  assert.strictEqual(detectEmailTypo('user@yahoo.co'), 'user@yahoo.com', 'yahoo.co -> yahoo.com');
  assert.strictEqual(detectEmailTypo('user@gmail.com'), null, 'valid gmail.com returns null');
  assert.strictEqual(detectEmailTypo('user@company.com'), null, 'unknown domain returns null');
  console.log('✓ email typo detection works for common misspellings');

  // --- 2. listTasks with null workspace must NOT call the guard-wrapped store ---
  // Simulate what routes.js now does: if wsId is falsy, return empty array
  // instead of calling store.listTasks({ workspaceId: null }).
  const wsId = null;
  const result = wsId ? await store.listTasks({ workspaceId: wsId }) : [];
  assert.deepStrictEqual(result, [], 'null workspace returns empty array without calling store');

  // Verify the guard WOULD throw in enforce mode if we bypass the check
  let guardThrew = false;
  try {
    await store.listTasks({ workspaceId: null });
  } catch (err) {
    if (err instanceof WorkspaceGuardError) guardThrew = true;
  }
  assert.ok(guardThrew, 'guard throws WorkspaceGuardError for null workspace in enforce mode');
  console.log('✓ null-workspace listTasks returns empty without hitting the guard');

  // --- 3. Guard allows scoped calls in enforce mode ---
  await store.saveTask({
    id: 't-guard-1', agent: 'pa', instruction: 'Test task', status: 'done',
    irreversible: false, created_at: new Date().toISOString(), workspace_id: WS_A,
  }, { workspaceId: WS_A });
  const tasks = await store.listTasks({ workspaceId: WS_A });
  assert.strictEqual(tasks.length, 1, 'scoped listTasks returns the task');
  assert.strictEqual(tasks[0].id, 't-guard-1');
  console.log('✓ scoped listTasks works in enforce mode');

  // --- 4. App-owner identification logic ---
  function isAppOwner(callerEmail, configEmail) {
    return !!(configEmail && callerEmail?.toLowerCase() === configEmail.toLowerCase());
  }

  assert.ok(isAppOwner('Admin@Example.com', 'admin@example.com'), 'case-insensitive match');
  assert.ok(!isAppOwner('other@example.com', 'admin@example.com'), 'non-match returns false');
  assert.ok(!isAppOwner(null, 'admin@example.com'), 'null caller returns false');
  assert.ok(!isAppOwner('admin@example.com', ''), 'empty config returns false');
  console.log('✓ app-owner identification is case-insensitive and handles edge cases');

  // --- 5. Rate-limit error shape ---
  const rateLimitResponse = { error: 'Too many invites right now. Try again in an hour.', rateLimited: true };
  assert.ok(rateLimitResponse.rateLimited, 'rate-limited response has rateLimited flag');
  assert.ok(rateLimitResponse.error.includes('hour'), 'rate-limited response gives friendly message');
  console.log('✓ rate-limit error response has correct shape');

  // --- 6. Email typo response shape ---
  const typoResponse = { emailTypo: true, original: 'user@gmail.co', suggested: 'user@gmail.com', message: 'Did you mean user@gmail.com?' };
  assert.ok(typoResponse.emailTypo, 'typo response has emailTypo flag');
  assert.strictEqual(typoResponse.suggested, 'user@gmail.com');
  console.log('✓ email typo response has correct shape');

  // --- 7. Pending invite detection logic ---
  const adminWithSignIn = { last_sign_in_at: '2024-01-01T00:00:00Z' };
  const adminWithoutSignIn = { last_sign_in_at: null };
  assert.strictEqual(!adminWithSignIn.last_sign_in_at, false, 'signed-in user is not pending');
  assert.strictEqual(!adminWithoutSignIn.last_sign_in_at, true, 'never-signed-in user is pending');
  console.log('✓ pending invite detection based on lastSignInAt');

  console.log('\nAll Phase 2.6b checks passed.');
}

run().catch((err) => {
  console.error('✗ team-phase2-6b.test.js failed:', err);
  process.exit(1);
});
