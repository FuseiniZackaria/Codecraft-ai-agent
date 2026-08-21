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

  const branchGraph = {
    nodes: [
      { id: 'trigger_1', type: 'trigger', config: {} },
      { id: 'decide_1', type: 'decide', config: { question: 'Anything worth doing?', options: [{ id: 'check_competitors', label: 'Research competitors' }, { id: 'check_leads', label: 'Look for new leads' }] } },
      { id: 'competitor_research', type: 'agent', config: { agentKey: 'research', goal: 'Research competitors' } },
      { id: 'lead_research', type: 'agent', config: { agentKey: 'research', goal: 'Find new leads' } },
    ],
    edges: [
      { id: 'e1', source: 'trigger_1', target: 'decide_1' },
      { id: 'e2', source: 'decide_1', target: 'competitor_research', branch: 'check_competitors' },
      { id: 'e3', source: 'decide_1', target: 'lead_research', branch: 'check_leads' },
    ],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-decide-1', name: 'Self-prompt test 1', graph: branchGraph, enabled: true });

  let restore = stub(async ({ system }) => (system?.includes('choice') ? { text: '{"choice": "check_competitors"}', provider: 'mock', costEstimate: 0 } : { text: 'Real findings.', provider: 'mock', costEstimate: 0 }));
  const run1 = await workflowEngine.runWorkflow('wf-decide-1');
  assert.strictEqual(run1.context.decide_1.output, 'check_competitors');
  assert(run1.context.competitor_research, 'the chosen branch should genuinely execute');
  assert(!run1.context.lead_research, 'the un-chosen branch must never execute');
  restore();
  console.log('✓ decide correctly branches to the chosen action among a curated menu, and only that one');

  restore = stub(async ({ system }) => (system?.includes('choice') ? { text: '{"choice": "NONE"}', provider: 'mock', costEstimate: 0 } : { text: 'should never be reached', provider: 'mock', costEstimate: 0 }));
  const run2 = await workflowEngine.runWorkflow('wf-decide-1');
  assert.strictEqual(run2.status, 'done', 'choosing NONE should end the run cleanly, not error');
  assert.strictEqual(run2.context.decide_1.output, 'NONE');
  assert(!run2.context.competitor_research && !run2.context.lead_research, 'nothing should run when NONE is chosen');
  restore();
  console.log('✓ choosing NONE ends the run cleanly with no downstream action executed');

  const safetyGraph = {
    nodes: [
      { id: 'trigger_1', type: 'trigger', config: {} },
      { id: 'decide_1', type: 'decide', config: { question: 'Anything worth doing?', options: [{ id: 'check_competitors', label: 'Research competitors' }] } },
      { id: 'competitor_research', type: 'agent', config: { agentKey: 'research', goal: 'Research competitors' } },
    ],
    edges: [
      { id: 'e1', source: 'trigger_1', target: 'decide_1' },
      { id: 'e2', source: 'decide_1', target: 'competitor_research', branch: 'check_competitors' },
    ],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-decide-safety', name: 'Safety test', graph: safetyGraph, enabled: true });

  restore = stub(async () => ({ text: 'I think you should research competitors!', provider: 'mock', costEstimate: 0 }));
  const run3 = await workflowEngine.runWorkflow('wf-decide-safety');
  assert.strictEqual(run3.status, 'done', 'an unparseable response should never crash the run');
  assert.strictEqual(run3.context.decide_1.output, 'NONE', 'unparseable garbage must default to NONE');
  assert(!run3.context.competitor_research, 'no action should run despite the text mentioning it');
  restore();
  console.log('✓ an unparseable/garbage response safely defaults to NONE instead of crashing or guessing into action');

  restore = stub(async () => ({ text: '{"choice": "send_all_my_emails"}', provider: 'mock', costEstimate: 0 }));
  const run4 = await workflowEngine.runWorkflow('wf-decide-safety');
  assert.strictEqual(run4.context.decide_1.output, 'NONE', 'a choice outside the curated menu must be rejected, never trusted verbatim');
  restore();
  console.log('✓ a hallucinated choice outside the curated menu is rejected and defaults to NONE');

  restore = stub(async () => {
    throw new Error('network failure');
  });
  const run5 = await workflowEngine.runWorkflow('wf-decide-safety');
  assert.strictEqual(run5.status, 'done', 'a provider failure during the decision must be caught, not crash the run');
  assert.strictEqual(run5.context.decide_1.output, 'NONE');
  restore();
  console.log('✓ a provider error during the decision is caught and safely defaults to NONE');

  const fullGraph = {
    nodes: [
      { id: 'trigger_1', type: 'trigger', config: {} },
      { id: 'decide_1', type: 'decide', config: { question: 'Anything worth doing?', options: [{ id: 'draft_response', label: 'Draft a response' }] } },
      { id: 'draft_1', type: 'agent', config: { agentKey: 'ceo', goal: 'Draft a response' } },
      { id: 'approval_1', type: 'approval', config: { label: 'Review before this goes anywhere' } },
    ],
    edges: [
      { id: 'e1', source: 'trigger_1', target: 'decide_1' },
      { id: 'e2', source: 'decide_1', target: 'draft_1', branch: 'draft_response' },
      { id: 'e3', source: 'draft_1', target: 'approval_1' },
    ],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-decide-full', name: 'Full self-prompt test', graph: fullGraph, enabled: true });
  restore = stub(async ({ system }) => (system?.includes('choice') ? { text: '{"choice": "draft_response"}', provider: 'mock', costEstimate: 0 } : { text: 'A drafted response.', provider: 'mock', costEstimate: 0 }));
  const runFull = await workflowEngine.runWorkflow('wf-decide-full');
  assert.strictEqual(runFull.context.decide_1.output, 'draft_response', 'the system should have decided on its own, with no goal given at trigger time');
  assert(runFull.context.draft_1, 'the self-initiated action should genuinely execute, not just be suggested');
  assert.strictEqual(runFull.status, 'paused_for_approval', 'a self-initiated run must still pause for human approval before anything irreversible');
  const task = await memory.getTask(runFull.pausedTaskId);
  assert.strictEqual(task.status, 'pending_approval', 'a real, reviewable approval task must exist');
  restore();
  console.log('✓ CORE REQUIREMENT: a self-initiated decision genuinely executes a real action, and still correctly pauses for human approval');

  // Real recent activity should genuinely reach the decision prompt, not
  // just a static question asked in a vacuum.
  const crypto = require('crypto');
  const seededTaskId = crypto.randomUUID();
  await memory.saveTask({ id: seededTaskId, agent: 'research', instruction: 'Research competitor pricing', status: 'pending', created_at: new Date().toISOString() });
  await memory.updateTask(seededTaskId, { status: 'done', result: [{ text: 'Competitor X just launched a major price cut.' }] });

  let capturedPrompt = null;
  restore = stub(async ({ system, prompt }) => {
    if (system?.includes('choice')) {
      capturedPrompt = prompt;
      return { text: '{"choice": "respond_to_pricing"}', provider: 'mock', costEstimate: 0 };
    }
    return { text: 'Drafted a response.', provider: 'mock', costEstimate: 0 };
  });
  const contextGraph = {
    nodes: [
      { id: 'trigger_1', type: 'trigger', config: {} },
      { id: 'decide_1', type: 'decide', config: { question: 'Given recent activity, is there something worth doing?', options: [{ id: 'respond_to_pricing', label: 'Draft a response to the pricing change' }] } },
      { id: 'respond', type: 'agent', config: { agentKey: 'ceo', goal: 'Draft a response' } },
    ],
    edges: [
      { id: 'e1', source: 'trigger_1', target: 'decide_1' },
      { id: 'e2', source: 'decide_1', target: 'respond', branch: 'respond_to_pricing' },
    ],
  };
  await memory.saveWorkflowDefinition({ id: 'wf-decide-context', name: 'Context test', graph: contextGraph, enabled: true });
  const runContext = await workflowEngine.runWorkflow('wf-decide-context');
  assert(capturedPrompt.includes('Competitor X just launched a major price cut'), 'real recent activity must genuinely reach the decision prompt');
  assert.strictEqual(runContext.context.decide_1.output, 'respond_to_pricing', 'the decision should reflect the real signal it was given');
  restore();
  console.log('✓ real recent activity genuinely reaches the decision prompt and informs the choice, not asked in a vacuum');

  console.log('\nAll self-prompting (decide node) checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
