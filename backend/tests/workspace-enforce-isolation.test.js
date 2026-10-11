// Phase 2.3d: verify enforce mode isolates two accounts, both from the
// store side (no leakage of rows between workspaces when reads are
// workspace-scoped) and from the guard side (unscoped user calls throw).
//
// This test simulates two accounts sharing one server. The real
// end-to-end check (login as account B in a browser, confirm you see
// zero of account A's data) still needs to happen on the deployed app;
// this test proves the backend layer that drives the UI isolates the
// data correctly before enforce mode gets flipped.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';

const assert = require('assert');

async function run() {
  // --- Part 1: run with the guard still in LOG mode (default) ---
  //
  // Prove that even BEFORE enforce flips, a workspace-scoped read of each
  // table returns only its own workspace's rows plus legacy (null-
  // stamped) rows, never another workspace's rows.
  process.env.WORKSPACE_GUARD_MODE = 'log';
  const MemoryStore = require('../memory/MemoryStore');
  const { withWorkspaceGuard, currentMode, WorkspaceGuardError } = require('../memory/workspaceGuard');
  assert.strictEqual(currentMode(), 'log', 'default mode is log');

  const store = withWorkspaceGuard(new MemoryStore());
  const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  // Seed each workspace with real rows across every relevant table.
  const seedAccount = async (ws, label) => {
    await store.saveTask({ id: `t-${label}`, agent: 'research', instruction: `${label}: do X`, status: 'done', irreversible: false, created_at: new Date().toISOString(), workspace_id: ws }, { workspaceId: ws });
    await store.addChatMessage({ role: 'user', content: `${label}: hello`, workspace_id: ws }, { workspaceId: ws });
    await store.audit('system', 'test_event', `${label}-target`, { workspaceId: ws }, { workspaceId: ws });
    await store.saveWorkflow({ id: `wf-${label}`, name: `${label} wf`, goal: 'g', scheduleType: 'interval', intervalMinutes: 60, enabled: true, lastRunAt: null, createdAt: new Date().toISOString(), workspace_id: ws }, { workspaceId: ws });
    await store.saveWorkflowDefinition({ id: `def-${label}`, name: `${label} def`, graph: { nodes: [], edges: [] }, enabled: true, workspace_id: ws }, { workspaceId: ws });
    await store.saveSkill({ id: `sk-${label}`, name: `${label}`, version: '1.0.0', installedAt: new Date().toISOString(), workspace_id: ws });
    await store.addFact(`${label}'s secret fact`, { workspaceId: ws });
    await store.createOutreachThread({ id: `ot-${label}`, recipientEmail: `${label}@ex.com`, agentKey: 'sales', workspace_id: ws }, { workspaceId: ws });
  };
  await seedAccount(WS_A, 'alice');
  await seedAccount(WS_B, 'bob');

  // Alice's workspace-scoped reads must NEVER include Bob's rows.
  const containsNoBob = (rows, field = 'id') => {
    for (const r of rows) {
      const v = r?.[field] || r?.workflowGoal || r?.content || r?.target || r?.fact || '';
      assert.ok(!String(v).includes('bob'),
        `isolation leak: alice's read returned a bob row - ${JSON.stringify(r).slice(0, 160)}`);
    }
  };
  containsNoBob(await store.listTasks({ workspaceId: WS_A }));
  containsNoBob(await store.listChatMessages(100, { workspaceId: WS_A }), 'content');
  containsNoBob(await store.listWorkflows({ workspaceId: WS_A }));
  containsNoBob(await store.listWorkflowDefinitions({ workspaceId: WS_A }));
  containsNoBob(await store.listSkills({ workspaceId: WS_A }));
  containsNoBob(await store.getFacts(50, { workspaceId: WS_A }), 'fact');
  containsNoBob(await store.getAuditLog(100, { workspaceId: WS_A }), 'target');
  console.log('✓ workspace A sees zero of workspace B\'s rows across tasks, chat, audit, workflows, defs, skills, facts');

  // Mirror check: Bob sees zero of Alice.
  const containsNoAlice = (rows, field = 'id') => {
    for (const r of rows) {
      const v = r?.[field] || r?.workflowGoal || r?.content || r?.target || r?.fact || '';
      assert.ok(!String(v).includes('alice'),
        `isolation leak: bob's read returned an alice row - ${JSON.stringify(r).slice(0, 160)}`);
    }
  };
  containsNoAlice(await store.listTasks({ workspaceId: WS_B }));
  containsNoAlice(await store.listChatMessages(100, { workspaceId: WS_B }), 'content');
  containsNoAlice(await store.getFacts(50, { workspaceId: WS_B }), 'fact');
  console.log('✓ workspace B sees zero of workspace A\'s rows (symmetric check)');

  // --- Part 2: flip to ENFORCE mode ---
  //
  // Unscoped reads/writes from a user path must throw with a clear code,
  // while named system callers (scheduler-tick, etc.) keep working.
  process.env.WORKSPACE_GUARD_MODE = 'enforce';
  assert.strictEqual(currentMode(), 'enforce', 'env flipped to enforce');

  // 2a. An unscoped list throws.
  await assert.rejects(
    () => store.listTasks(),
    (err) => err instanceof WorkspaceGuardError && err.code === 'list_without_workspace' && err.method === 'listTasks'
  );
  console.log('✓ enforce mode: unscoped listTasks() throws WorkspaceGuardError(list_without_workspace)');

  // 2b. An unscoped write throws.
  await assert.rejects(
    () => store.saveTask({ id: 't-unscoped', agent: 'x', instruction: 'oops', status: 'done', irreversible: false, created_at: new Date().toISOString() }),
    (err) => err instanceof WorkspaceGuardError && err.code === 'no_workspace_on_call_or_row'
  );
  console.log('✓ enforce mode: unscoped saveTask() throws WorkspaceGuardError(no_workspace_on_call_or_row)');

  // 2c. A workspace-mismatched write throws.
  await assert.rejects(
    () => store.saveTask(
      { id: 't-mix', agent: 'x', instruction: 'cross', status: 'done', irreversible: false, created_at: new Date().toISOString(), workspace_id: WS_A },
      { workspaceId: WS_B }
    ),
    (err) => err instanceof WorkspaceGuardError && err.code === 'workspace_mismatch'
  );
  console.log('✓ enforce mode: workspace-mismatched saveTask throws WorkspaceGuardError(workspace_mismatch)');

  // 2d. A scope:"system" with an unknown systemCaller throws (not silently allowed).
  await assert.rejects(
    () => store.listTasks({ scope: 'system', systemCaller: 'not-on-the-allowlist' }),
    (err) => err instanceof WorkspaceGuardError && err.code === 'system_scope_but_caller_not_allowlisted'
  );
  console.log('✓ enforce mode: scope:"system" with unknown systemCaller is refused');

  // 2e. A proper workspace-scoped read SUCCEEDS and only returns Alice's data.
  const aliceTasks = await store.listTasks({ workspaceId: WS_A });
  assert.ok(aliceTasks.some((t) => t.id === 't-alice'), 'alice still sees her own task');
  assert.ok(!aliceTasks.some((t) => t.id === 't-bob'), 'alice must NOT see bob\'s task');
  console.log('✓ enforce mode: workspace-scoped reads still work and stay isolated');

  // 2f. A named system caller (scheduler-tick) is still allowed to list
  //     every workspace's workflows - that's its job.
  const everyWorkflow = await store.listWorkflows({ scope: 'system', systemCaller: 'scheduler-tick' });
  assert.ok(everyWorkflow.some((w) => w.id === 'wf-alice'), 'scheduler-tick sees alice workflow');
  assert.ok(everyWorkflow.some((w) => w.id === 'wf-bob'),   'scheduler-tick sees bob workflow');
  console.log('✓ enforce mode: named system callers (scheduler-tick) still read across all workspaces');

  console.log('\nAll Phase 2.3d enforce + isolation checks passed.');
}

run().catch((err) => {
  console.error('✗ workspace-enforce-isolation.test.js failed:', err);
  process.exit(1);
});
