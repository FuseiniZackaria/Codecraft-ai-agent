// Force in-memory store.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';

const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const orchestrator = require('../core/orchestrator');
const memory = require('../memory');
const toolRegistry = require('../tools/ToolRegistry');
const { readShadowLog, clearShadowLog } = require('../memory/workspaceGuard');

async function main() {
  loadPlugins();

  const WS_A = '11111111-1111-1111-1111-111111111111';
  const WS_B = '22222222-2222-2222-2222-222222222222';

  // --- 1. submitGoal({ workspaceId }) stamps the task row with workspace_id. ---
  clearShadowLog();
  const [taskA] = await orchestrator.submitGoal('Send an email to prospect@example.com about demo', {
    payload: { to: 'prospect@example.com', subject: 'Demo', body: 'Hello' },
    workspaceId: WS_A,
  });
  assert.strictEqual(taskA.workspace_id, WS_A,
    'submitGoal({ workspaceId }) must stamp the task row - got: ' + taskA.workspace_id);
  console.log('✓ workspace-stamping: submitGoal stamps workspace_id onto the new task row');

  // --- 2. Shadow log stays empty for the stamped path (no "no_workspace_on_call_or_row"). ---
  const log = readShadowLog();
  const misses = log.filter((e) => e.reason === 'no_workspace_on_call_or_row' && e.method === 'saveTask');
  assert.strictEqual(misses.length, 0,
    `saveTask with workspaceId must not generate a shadow-log miss - got ${misses.length}`);
  console.log('✓ workspace-stamping: a stamped saveTask produces no shadow-log miss');

  // --- 3. A call without workspaceId still produces a shadow-log miss. ---
  clearShadowLog();
  await memory.saveTask({
    id: require('uuid').v4(),
    agent: 'test',
    instruction: 'legacy task with no workspace',
    status: 'pending',
    irreversible: false,
    created_at: new Date().toISOString(),
  });
  const missLog = readShadowLog();
  assert.ok(
    missLog.find((e) => e.method === 'saveTask' && e.reason === 'no_workspace_on_call_or_row'),
    'legacy call must still produce a shadow-log miss'
  );
  console.log('✓ workspace-stamping: a legacy call without workspaceId still produces a shadow-log miss (the signal we need)');

  // --- 4. approveTask pulls workspaceId from the task row when the caller didn't supply one. ---
  clearShadowLog();
  const originalGmail = toolRegistry.tools.get('gmail.sendEmail');
  let capturedCtx = null;
  toolRegistry.tools.set('gmail.sendEmail', {
    permission: 'gmail.send',
    irreversible: true,
    run: async (_args, ctx) => { capturedCtx = ctx; return { status: 'sent' }; },
  });
  try {
    await orchestrator.approveTask(taskA.id); // no options.workspaceId - comes from task.workspace_id
  } finally {
    if (originalGmail) toolRegistry.tools.set('gmail.sendEmail', originalGmail);
  }
  assert.strictEqual(capturedCtx?.workspaceId, WS_A,
    'approveTask should surface the task row workspace_id as ctx.workspaceId when the caller omits it');
  console.log('✓ workspace-stamping: approveTask reuses task.workspace_id when caller omits workspaceId');

  // --- 5. Cross-workspace write mismatch is logged (caller WS_B, row WS_A). ---
  clearShadowLog();
  const uuid = require('uuid').v4;
  const taskId3 = uuid();
  await memory.saveTask(
    {
      id: taskId3,
      agent: 'test',
      instruction: 'cross-workspace write attempt',
      status: 'pending',
      irreversible: false,
      created_at: new Date().toISOString(),
      workspace_id: WS_A,
    },
    { workspaceId: WS_B }
  );
  const mismatch = readShadowLog().find((e) => e.reason === 'workspace_mismatch');
  assert.ok(mismatch, 'cross-workspace write must be shadow-logged');
  assert.strictEqual(mismatch.callerWs, WS_B);
  assert.strictEqual(mismatch.rowWs, WS_A);
  console.log('✓ workspace-stamping: a caller/row workspace_id mismatch is captured for later audit');

  clearShadowLog();
  console.log('\nAll workspace-stamping checks passed.');
}

main().catch((err) => {
  console.error('✗ workspace-stamping.test.js failed:', err);
  process.exit(1);
});
