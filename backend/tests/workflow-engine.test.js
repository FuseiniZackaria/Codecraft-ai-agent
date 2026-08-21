const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadPlugins } = require('../core/pluginLoader');
const memory = require('../memory');
const mockProvider = require('../core/providers/mockProvider');
const workflowEngine = require('../core/workflowEngine');
const { WORKSPACE_ROOT } = require('../plugins/filesystem/workspaceSafety');

function stub(responder) {
  const original = mockProvider.complete;
  mockProvider.complete = responder;
  return () => { mockProvider.complete = original; };
}

async function main() {
  const plugins = loadPlugins();
  assert(plugins.includes('filesystem'), 'filesystem plugin should load');

  let call = 0;
  let restore = stub(async ({ system }) => {
    call++;
    if (call <= 2) return { text: 'Competitor X launched a new AI feature this week.', provider: 'mock', costEstimate: 0 };
    if (system?.includes('yes') && system?.includes('no')) return { text: 'yes', provider: 'mock', costEstimate: 0 };
    return { text: 'We should respond by highlighting our own roadmap.', provider: 'mock', costEstimate: 0 };
  });

  const graph = {
    nodes: [
      { id: 'trigger_1', type: 'trigger', config: {} },
      { id: 'node_2', type: 'agent', config: { agentKey: 'research', goal: 'Research competitors' } },
      { id: 'node_3', type: 'condition', config: { question: 'Concerning? {{node_2.output}}' } },
      { id: 'node_4', type: 'agent', config: { agentKey: 'ceo', goal: 'Respond to: {{node_2.output}}' } },
      { id: 'node_5', type: 'approval', config: { label: 'Review before saving' } },
      { id: 'node_6', type: 'tool', config: { tool: 'filesystem.writeFile', args: { projectId: 'workflow-engine-test', path: 'response.txt', content: '{{node_4.output}}' } } },
    ],
    edges: [
      { id: 'e1', source: 'trigger_1', target: 'node_2' },
      { id: 'e2', source: 'node_2', target: 'node_3' },
      { id: 'e3', source: 'node_3', target: 'node_4', branch: 'yes' },
      { id: 'e4', source: 'node_4', target: 'node_5' },
      { id: 'e5', source: 'node_5', target: 'node_6' },
    ],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-full-test', name: 'Full test', graph, enabled: true });

  const run1 = await workflowEngine.runWorkflow('wf-full-test');
  assert.strictEqual(run1.status, 'paused_for_approval', 'should pause at the approval node');
  assert(run1.context.node_4.output.includes('respond'), 'node_4 should have used node_2 output as context');

  const pausedTask = await memory.getTask(run1.pausedTaskId);
  assert.strictEqual(pausedTask.status, 'pending_approval', 'a real pending_approval task should be created');
  assert.strictEqual(pausedTask.workflowRunId, run1.id, 'the task should link back to the run');
  console.log('✓ workflow correctly runs, threads context between nodes, and pauses at an approval checkpoint with a real linked task');

  const run2 = await workflowEngine.resumeWorkflow(run1.id);
  assert.strictEqual(run2.status, 'done', 'should complete after resuming');
  const written = fs.readFileSync(path.join(WORKSPACE_ROOT, 'workflow-engine-test', 'response.txt'), 'utf-8');
  assert.strictEqual(written, 'We should respond by highlighting our own roadmap.', 'the real tool call should use the threaded context correctly');
  console.log('✓ resuming after approval continues the graph and the real tool call uses correctly threaded context');
  fs.rmSync(path.join(WORKSPACE_ROOT, 'workflow-engine-test'), { recursive: true, force: true });
  restore();

  restore = stub(async ({ system }) => ({
    text: system?.includes('yes') && system?.includes('no') ? 'no' : 'Nothing concerning.',
    provider: 'mock',
    costEstimate: 0,
  }));
  const branchGraph = {
    nodes: [
      { id: 't1', type: 'trigger', config: {} },
      { id: 'n1', type: 'agent', config: { agentKey: 'research', goal: 'Research something' } },
      { id: 'n2', type: 'condition', config: { question: 'Concerning?' } },
      { id: 'n3', type: 'agent', config: { agentKey: 'ceo', goal: 'Should never run' } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'n1' },
      { id: 'e2', source: 'n1', target: 'n2' },
      { id: 'e3', source: 'n2', target: 'n3', branch: 'yes' },
    ],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-branch-test', name: 'Branch test', graph: branchGraph, enabled: true });
  const branchRun = await workflowEngine.runWorkflow('wf-branch-test');
  assert.strictEqual(branchRun.status, 'done', 'should end cleanly when the taken branch has no outgoing edge');
  assert(!branchRun.context.n3, 'the un-taken branch must never execute');
  console.log('✓ a branch with no matching edge ends the run cleanly instead of erroring');
  restore();

  restore = stub(async () => ({ text: 'handled', provider: 'mock', costEstimate: 0 }));
  const switchGraph = {
    nodes: [
      { id: 't1', type: 'trigger', config: {} },
      { id: 's1', type: 'switch', config: { value: 'urgent' } },
      { id: 'n_urgent', type: 'agent', config: { agentKey: 'ceo', goal: 'Handle urgent' } },
      { id: 'n_normal', type: 'agent', config: { agentKey: 'ceo', goal: 'Handle normal' } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 's1' },
      { id: 'e2', source: 's1', target: 'n_urgent', branch: 'urgent' },
      { id: 'e3', source: 's1', target: 'n_normal', branch: 'normal' },
    ],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-switch-test', name: 'Switch test', graph: switchGraph, enabled: true });
  const switchRun = await workflowEngine.runWorkflow('wf-switch-test');
  assert(switchRun.context.n_urgent, 'should take the matching branch');
  assert(!switchRun.context.n_normal, 'should not take the non-matching branch');
  console.log('✓ switch nodes route to the correct branch among several options');
  restore();

  const failGraph = {
    nodes: [
      { id: 't1', type: 'trigger', config: {} },
      { id: 'bad', type: 'agent', config: { agentKey: 'nonexistent_agent', goal: 'This will fail' } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'bad' }],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-fail-test', name: 'Failure test', graph: failGraph, enabled: true });
  const failRun = await workflowEngine.runWorkflow('wf-fail-test');
  assert.strictEqual(failRun.status, 'failed');
  assert(failRun.error.includes('nonexistent_agent'), 'the real error should be captured, not swallowed');
  console.log('✓ a node referencing an unknown agent fails the run cleanly with a clear error');

  const { resolveTemplate } = workflowEngine;
  const ctx = { node_1: { output: 'hello world' } };
  assert.strictEqual(resolveTemplate('Say: {{node_1.output}}', ctx), 'Say: hello world');
  assert.strictEqual(
    resolveTemplate('Unresolved: {{node_missing.output}}', ctx),
    'Unresolved: {{node_missing.output}}',
    'an unresolvable reference should stay visible, not silently blank out'
  );
  console.log('✓ template resolution substitutes known references and leaves unknown ones visibly unresolved');

  console.log('\nAll workflow engine checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
