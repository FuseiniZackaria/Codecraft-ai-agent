// Phase 2.3c follow-up: workspace-guard support for explicit system scope.
// Verifies the strict allowlist, the "attempted-but-not-allowlisted"
// warning, and that scheduler tick / plugin-loader audit paths don't
// generate shadow-log misses.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';

const assert = require('assert');
const MemoryStore = require('../memory/MemoryStore');
const { withWorkspaceGuard, readShadowLog, clearShadowLog, ALLOWED_SYSTEM_CALLERS } =
  require('../memory/workspaceGuard');

async function main() {
  // --- 1. Allowlist exposes the exact set of acceptable system callers. ---
  assert.ok(ALLOWED_SYSTEM_CALLERS instanceof Set, 'ALLOWED_SYSTEM_CALLERS exported as a Set');
  for (const name of [
    'scheduler-tick', 'scheduler-migrate', 'plugin-loader', 'startup',
    'response-detection', 'outreach-pipeline', 'auto-reply-safety',
    'personal-assistant-system', 'briefing-agent-system',
    'installer-startup', 'workflow-engine-system',
    'webhook-telegram', 'webhook-whatsapp', 'test',
  ]) {
    assert.ok(ALLOWED_SYSTEM_CALLERS.has(name), `allowlist contains "${name}"`);
  }
  console.log('✓ ALLOWED_SYSTEM_CALLERS has the expected named-caller allowlist');

  // --- 2. A legitimate system list call produces ZERO shadow-log entries. ---
  const guarded = withWorkspaceGuard(new MemoryStore());
  clearShadowLog();
  await guarded.listWorkflows({ scope: 'system', systemCaller: 'scheduler-tick' });
  await guarded.listWorkflowDefinitions({ scope: 'system', systemCaller: 'scheduler-tick' });
  await guarded.listTasks({ scope: 'system', systemCaller: 'response-detection' });
  await guarded.audit('system', 'plugin_loaded', 'x', {}, { scope: 'system', systemCaller: 'plugin-loader' });
  const silentLog = readShadowLog();
  assert.strictEqual(silentLog.length, 0,
    `allowlisted system calls must be silent - got ${silentLog.length} entries: ${JSON.stringify(silentLog.slice(0, 3))}`);
  console.log('✓ allowlisted system calls (scheduler-tick, response-detection, plugin-loader) are silent');

  // --- 3. An unrecognized systemCaller is explicitly flagged, not silently allowed. ---
  clearShadowLog();
  await guarded.listTasks({ scope: 'system', systemCaller: 'definitely-not-on-the-list' });
  const unlistedLog = readShadowLog();
  const flag = unlistedLog.find((e) =>
    e.method === 'listTasks' &&
    e.reason === 'system_scope_but_caller_not_allowlisted' &&
    e.attemptedSystemCaller === 'definitely-not-on-the-list'
  );
  assert.ok(flag, 'unknown systemCaller must be visibly logged, not silently allowed through');
  console.log('✓ a scope:"system" with an unknown systemCaller is flagged separately in the shadow log');

  // --- 4. A missing systemCaller alongside scope:"system" is also flagged. ---
  clearShadowLog();
  await guarded.listTasks({ scope: 'system' });
  const noName = readShadowLog().find((e) =>
    e.method === 'listTasks' && e.reason === 'system_scope_but_caller_not_allowlisted'
  );
  assert.ok(noName, 'scope:"system" without a systemCaller must also be flagged');
  console.log('✓ scope:"system" with no systemCaller is flagged (no silent pass-through)');

  // --- 5. User-path calls (plain workspaceId) still produce zero noise. ---
  clearShadowLog();
  await guarded.listTasks({ workspaceId: '11111111-1111-1111-1111-111111111111' });
  assert.strictEqual(readShadowLog().length, 0, 'workspace-scoped user calls stay silent');
  console.log('✓ ordinary workspace-scoped user calls remain silent');

  // --- 6. Missing scope AND missing workspaceId still logs the normal miss. ---
  clearShadowLog();
  await guarded.listTasks(); // completely unscoped
  const legacyMiss = readShadowLog().find((e) =>
    e.method === 'listTasks' && e.reason === 'list_without_workspace'
  );
  assert.ok(legacyMiss, 'unscoped list call must still produce the ordinary list_without_workspace miss');
  console.log('✓ a legacy fully-unscoped list call is still caught (regression guard)');

  clearShadowLog();
  console.log('\nAll workspace system-scope checks passed.');
}

main().catch((err) => {
  console.error('✗ workspace-system-scope.test.js failed:', err);
  process.exit(1);
});
