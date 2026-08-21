const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const memory = require('../memory');
const mockProvider = require('../core/providers/mockProvider');
const workflowEngine = require('../core/workflowEngine');

function stub(responder) {
  const original = mockProvider.complete;
  mockProvider.complete = responder;
  return () => { mockProvider.complete = original; };
}

async function main() {
  loadPlugins();

  let restore = stub(async ({ prompt }) => {
    if ((prompt || '').includes('Process lead:')) {
      const m = prompt.match(/Process lead: (.+?) \(index (\d+)\)/);
      return { text: `Processed: ${m?.[1]} at index ${m?.[2]}`, provider: 'mock', costEstimate: 0 };
    }
    return { text: 'Lead A\nLead B\nLead C', provider: 'mock', costEstimate: 0 };
  });
  const loopGraph = {
    nodes: [
      { id: 't1', type: 'trigger', config: {} },
      { id: 'find_leads', type: 'agent', config: { agentKey: 'research', goal: 'Find 3 leads, one per line' } },
      {
        id: 'process_each',
        type: 'loop',
        config: {
          mode: 'list',
          listExpression: '{{find_leads.output}}',
          maxIterations: 10,
          resultNodeId: 'body_1',
          body: { nodes: [{ id: 'body_1', type: 'agent', config: { agentKey: 'ceo', goal: 'Process lead: {{loop.item}} (index {{loop.index}})' } }], edges: [] },
        },
      },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'find_leads' }, { id: 'e2', source: 'find_leads', target: 'process_each' }],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-loop-list', name: 'Loop list', graph: loopGraph, enabled: true });
  const loopRun = await workflowEngine.runWorkflow('wf-loop-list');
  assert.strictEqual(loopRun.status, 'done');
  const out = loopRun.context.process_each.output;
  assert(out.includes('Lead A at index 0') && out.includes('Lead B at index 1') && out.includes('Lead C at index 2'));
  restore();
  console.log('✓ loop (list mode) correctly resolves {{loop.item}} and {{loop.index}} per iteration');

  restore = stub(async ({ prompt }) => ({ text: `Ran index ${prompt.match(/index (\d+)/)?.[1]}`, provider: 'mock', costEstimate: 0 }));
  const countGraph = {
    nodes: [
      { id: 't1', type: 'trigger', config: {} },
      { id: 'loop_1', type: 'loop', config: { mode: 'count', count: 4, maxIterations: 20, resultNodeId: 'b1', body: { nodes: [{ id: 'b1', type: 'agent', config: { agentKey: 'ceo', goal: 'Run for index {{loop.index}}' } }], edges: [] } } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'loop_1' }],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-count', name: 'Count', graph: countGraph, enabled: true });
  const countRun = await workflowEngine.runWorkflow('wf-count');
  assert.strictEqual(countRun.context.loop_1.output.split('\n\n').length, 4, 'should run exactly 4 times');

  const uncappedGraph = JSON.parse(JSON.stringify(countGraph));
  uncappedGraph.nodes[1].config.count = 10000;
  uncappedGraph.nodes[1].config.maxIterations = 5;
  await memory.saveWorkflowDefinition({ id: 'wf-safety', name: 'Safety', graph: uncappedGraph, enabled: true });
  const safetyRun = await workflowEngine.runWorkflow('wf-safety');
  assert.strictEqual(safetyRun.context.loop_1.output.split('\n\n').length, 5, 'maxIterations must cap a huge count, not run 10000 times');
  restore();
  console.log('✓ loop (count mode) runs exactly N times, and maxIterations correctly caps a huge count');

  restore = stub(async ({ prompt }) => {
    await new Promise((r) => setTimeout(r, 80));
    return { text: `Result: ${prompt}`, provider: 'mock', costEstimate: 0 };
  });
  const parallelGraph = {
    nodes: [
      { id: 't1', type: 'trigger', config: {} },
      {
        id: 'p1',
        type: 'parallel',
        config: {
          branches: [
            { body: { nodes: [{ id: 'b1', type: 'agent', config: { agentKey: 'ceo', goal: 'Branch A' } }], edges: [] }, resultNodeId: 'b1' },
            { body: { nodes: [{ id: 'b2', type: 'agent', config: { agentKey: 'ceo', goal: 'Branch B' } }], edges: [] }, resultNodeId: 'b2' },
            { body: { nodes: [{ id: 'b3', type: 'agent', config: { agentKey: 'ceo', goal: 'Branch C' } }], edges: [] }, resultNodeId: 'b3' },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'p1' }],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-parallel', name: 'Parallel', graph: parallelGraph, enabled: true });
  const start = Date.now();
  const parallelRun = await workflowEngine.runWorkflow('wf-parallel');
  const elapsed = Date.now() - start;
  assert.strictEqual(parallelRun.context.p1.output.split('---').length, 3, 'all 3 branches should complete and join');
  assert(elapsed < 200, `branches should run concurrently (~80ms), took ${elapsed}ms - looks sequential`);
  restore();
  console.log('✓ parallel branches run genuinely concurrently and all results join correctly');

  restore = stub(async ({ prompt }) => ({ text: `Result of: ${prompt}`, provider: 'mock', costEstimate: 0 }));
  const innerGraph = { nodes: [{ id: 'it1', type: 'trigger', config: {} }, { id: 'in1', type: 'agent', config: { agentKey: 'ceo', goal: 'Inner task' } }], edges: [{ id: 'ie1', source: 'it1', target: 'in1' }] };
  const outerGraph = { nodes: [{ id: 'ot1', type: 'trigger', config: {} }, { id: 'sub1', type: 'sub_workflow', config: { workflowId: 'wf-inner', resultNodeId: 'in1' } }], edges: [{ id: 'oe1', source: 'ot1', target: 'sub1' }] };
  await memory.saveWorkflowDefinition({ id: 'wf-inner', name: 'Inner', graph: innerGraph, enabled: true });
  await memory.saveWorkflowDefinition({ id: 'wf-outer', name: 'Outer', graph: outerGraph, enabled: true });
  const subRun = await workflowEngine.runWorkflow('wf-outer');
  assert.strictEqual(subRun.status, 'done');
  assert(subRun.context.sub1.output.includes('Inner task'), 'outer workflow should correctly pick up the inner workflow output');
  console.log('✓ sub-workflow nesting correctly runs the nested graph and surfaces its output to the parent');

  const approvalInner = { nodes: [{ id: 'it1', type: 'trigger', config: {} }, { id: 'ap1', type: 'approval', config: { label: 'Nested' } }], edges: [{ id: 'ie1', source: 'it1', target: 'ap1' }] };
  await memory.saveWorkflowDefinition({ id: 'wf-inner-approval', name: 'Inner w/ approval', graph: approvalInner, enabled: true });
  const outer2 = JSON.parse(JSON.stringify(outerGraph));
  outer2.nodes[1].config.workflowId = 'wf-inner-approval';
  await memory.saveWorkflowDefinition({ id: 'wf-outer2', name: 'Outer 2', graph: outer2, enabled: true });
  const refusedRun = await workflowEngine.runWorkflow('wf-outer2');
  assert.strictEqual(refusedRun.status, 'failed');
  assert(refusedRun.error.includes('approval'), 'should clearly refuse a sub-workflow containing an approval node');
  console.log('✓ a sub-workflow containing an approval node is correctly refused, not silently mishandled');

  for (let i = 0; i < 7; i++) {
    const g = { nodes: [{ id: 't1', type: 'trigger', config: {} }, { id: 's1', type: 'sub_workflow', config: { workflowId: `wf-chain-${i + 1}`, resultNodeId: 'leaf' } }], edges: [{ id: 'e1', source: 't1', target: 's1' }] };
    await memory.saveWorkflowDefinition({ id: `wf-chain-${i}`, name: `Chain ${i}`, graph: g, enabled: true });
  }
  const leafGraph = { nodes: [{ id: 't1', type: 'trigger', config: {} }, { id: 'leaf', type: 'agent', config: { agentKey: 'ceo', goal: 'Leaf' } }], edges: [{ id: 'e1', source: 't1', target: 'leaf' }] };
  await memory.saveWorkflowDefinition({ id: 'wf-chain-7', name: 'Chain 7', graph: leafGraph, enabled: true });
  const chainRun = await workflowEngine.runWorkflow('wf-chain-0');
  assert.strictEqual(chainRun.status, 'failed');
  assert(chainRun.error.includes('max depth'), 'should enforce the max sub-workflow recursion depth');
  restore();
  console.log('✓ sub-workflow recursion depth is enforced, preventing an infinite chain');

  restore = stub(async () => ({ text: 'x', provider: 'mock', costEstimate: 0 }));
  const badLoop = { nodes: [{ id: 't1', type: 'trigger', config: {} }, { id: 'loop_1', type: 'loop', config: { mode: 'list', listExpression: 'x', maxIterations: 5, resultNodeId: 'ap1', body: { nodes: [{ id: 'ap1', type: 'approval', config: {} }], edges: [] } } }], edges: [{ id: 'e1', source: 't1', target: 'loop_1' }] };
  await memory.saveWorkflowDefinition({ id: 'wf-bad-loop', name: 'Bad loop', graph: badLoop, enabled: true });
  const badLoopRun = await workflowEngine.runWorkflow('wf-bad-loop');
  assert.strictEqual(badLoopRun.status, 'failed');
  assert(badLoopRun.error.includes('approval'), 'an approval node inside a loop body must be refused');
  restore();
  console.log('✓ disallowed node types (e.g. approval) inside a loop body are correctly refused');

  console.log('\nAll Phase 2 workflow engine checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
