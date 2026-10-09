// Force in-memory store for a self-contained end-to-end test.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';

const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const memory = require('../memory');
const BaseAgent = require('../agents/base/BaseAgent');
const activityLog = require('../core/activityLog');
const { clearShadowLog, readShadowLog } = require('../memory/workspaceGuard');
const { v4: uuid } = require('uuid');

async function main() {
  loadPlugins();

  const WS = 'ab3f12c4-aaaa-bbbb-cccc-ddddeeeeffff';

  // Minimal agent that just runs a plan with one llm_call (no provider calls needed:
  // we only care about the metadata flowing through activityLog + memory).
  class TestAgent extends BaseAgent {
    constructor() {
      super({ key: 'test-ws', role: 'Test WS Agent', tools: [] });
    }
    async plan() { return []; } // no steps - we're asserting on wrapper writes
  }

  // --- 1. activityLog.record stamps audit_log rows with workspace_id from metadata ---
  clearShadowLog();
  await activityLog.record('orchestrator', 'test_event', 'nothing', { workspaceId: WS, foo: 'bar' });
  // MemoryStore stashes audit entries in memory.auditLog
  const auditRow = (memory.auditLog || []).find((e) => e.action === 'test_event');
  assert.ok(auditRow, 'activityLog.record should persist an audit_log row');
  assert.strictEqual(auditRow.workspace_id, WS,
    'audit_log row must carry workspace_id from metadata.workspaceId');
  console.log('✓ workspace-e2e: activityLog.record stamps audit_log.workspace_id from metadata.workspaceId');

  // --- 2. BaseAgent.run propagates task.workspace_id into memory.remember entries ---
  const agent = new TestAgent();
  const task = {
    id: uuid(),
    agent: 'test-ws',
    instruction: 'test workspace flow',
    status: 'running',
    irreversible: false,
    created_at: new Date().toISOString(),
    workspace_id: WS,
  };
  await memory.saveTask(task, { workspaceId: WS });
  await agent.run(task);

  const memories = (memory.agentMemory?.get('Test WS Agent') || []);
  assert.ok(memories.length >= 2, 'expected at least task_start + task_end remember() calls');
  for (const m of memories) {
    assert.strictEqual(m.workspace_id, WS,
      `agent_memory entry (${m.type}) must carry workspace_id - got ${m.workspace_id}`);
  }
  console.log('✓ workspace-e2e: BaseAgent.run stamps agent_memory entries with task.workspace_id');

  // --- 3. BaseAgent.reflect stamps reflections.workspace_id ---
  const matchedReflection = (memory.reflections || []).find((r) => r.taskId === task.id);
  assert.ok(matchedReflection, 'reflect() should produce a reflection row');
  assert.strictEqual(matchedReflection.workspace_id, WS,
    'reflections row must carry workspace_id - got ' + matchedReflection.workspace_id);
  console.log('✓ workspace-e2e: BaseAgent.reflect stamps reflections.workspace_id');

  // --- 4. createApprovalTask inherits workspace_id from this._currentTask ---
  //     (simulates the common pattern where SalesAgent / PA call it from
  //     inside reflect(task, results), with no explicit workspaceId arg.)
  const parent = {
    id: uuid(),
    agent: 'test-ws',
    instruction: 'parent task carrying workspace',
    status: 'running',
    irreversible: false,
    created_at: new Date().toISOString(),
    workspace_id: WS,
  };
  await memory.saveTask(parent, { workspaceId: WS });

  // Hand-make the context the way run() would set it, so we don't need the agent
  // to actually have `whatsapp.sendMessage` wired as a real tool.
  class ToolAgent extends BaseAgent {
    constructor() { super({ key: 'test-tool-agent', role: 'Test Tool Agent', tools: ['whatsapp.sendMessage'] }); }
  }
  const toolAgent = new ToolAgent();
  toolAgent._currentTask = parent;
  const spawned = await toolAgent.createApprovalTask({
    instruction: 'spawned from parent',
    tool: 'whatsapp.sendMessage',
    payload: { to: '+1-555-0100', body: 'hi' },
    outreach: { recipientEmail: 'whatsapp:+1-555-0100', companyName: 'Example Co', campaign: 'lead_gen' },
  });
  assert.strictEqual(spawned.workspace_id, WS,
    'spawned task must inherit workspace_id from the parent task via _currentTask fallback');
  console.log('✓ workspace-e2e: createApprovalTask inherits workspace_id from the parent task (no per-caller change)');

  // --- 5. outreach_threads row created by createApprovalTask carries workspace_id ---
  const outreach = await memory.getOutreachThreadByApprovedTask(spawned.id);
  assert.ok(outreach, 'outreach_threads row should exist for the spawned approval task');
  assert.strictEqual(outreach.workspace_id || outreach.workspaceId, WS,
    'outreach_threads row must carry workspace_id - got ' + (outreach.workspace_id || outreach.workspaceId));
  console.log('✓ workspace-e2e: outreach_threads row created from createApprovalTask carries workspace_id');

  // --- 6. The shadow log should be empty for THIS run's write paths - every
  //     one of them supplied a workspaceId. ---
  const misses = readShadowLog().filter((e) =>
    (e.method === 'saveTask' || e.method === 'addReflection' || e.method === 'remember' || e.method === 'createOutreachThread') &&
    e.reason === 'no_workspace_on_call_or_row'
  );
  assert.strictEqual(misses.length, 0,
    `shadow log should have zero misses for the stamped paths - got ${misses.length}: ${JSON.stringify(misses.slice(0, 3))}`);
  console.log('✓ workspace-e2e: shadow log stays clean for the Phase 2.3b write paths');

  clearShadowLog();
  console.log('\nAll Phase 2.3b end-to-end workspace stamping checks passed.');
}

main().catch((err) => {
  console.error('✗ workspace-end-to-end.test.js failed:', err);
  process.exit(1);
});
