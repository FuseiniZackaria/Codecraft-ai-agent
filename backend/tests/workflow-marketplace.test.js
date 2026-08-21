const assert = require('assert');
const { v4: uuid } = require('uuid');
const { loadPlugins } = require('../core/pluginLoader');
const { WorkflowRegistry } = require('../core/workflowRegistry');
const memory = require('../memory');
const workflowEngine = require('../core/workflowEngine');
const mockProvider = require('../core/providers/mockProvider');

function stub(responder) {
  const original = mockProvider.complete;
  mockProvider.complete = responder;
  return () => { mockProvider.complete = original; };
}

async function main() {
  loadPlugins();
  const registry = new WorkflowRegistry();

  const all = registry.search();
  assert.strictEqual(all.length, 2, 'registry should have 2 real sample workflows');
  assert(all.every((e) => !e.graph), 'search results should not include the full graph payload');
  console.log('✓ registry search returns all entries with graph payload stripped');

  const salesResults = registry.search('sales');
  assert(salesResults.some((e) => e.id === 'lead-research-outreach-loop'));
  assert(!salesResults.some((e) => e.id === 'competitor-watch-alert'));
  console.log('✓ registry search filters correctly by category/description');

  const details = registry.getDetails('competitor-watch-alert');
  assert(details.graph && details.graph.nodes.length === 6, 'getDetails should return the full graph for install/preview');
  assert.throws(() => registry.getDetails('does-not-exist'), /not found/);
  console.log('✓ registry getDetails returns the full graph, and fails clearly for an unknown id');

  const entry = registry.getDetails('competitor-watch-alert');
  const definition = {
    id: uuid(),
    name: entry.name,
    graph: entry.graph,
    enabled: true,
    scheduleType: null,
    intervalMinutes: null,
    dailyTime: null,
    daysOfWeek: null,
    lastRunAt: null,
    createdAt: new Date().toISOString(),
  };
  await memory.saveWorkflowDefinition(definition);
  assert(await memory.getWorkflowDefinition(definition.id), 'installed definition should be retrievable');

  let call = 0;
  const restore = stub(async ({ system }) => {
    call++;
    if (call <= 2) return { text: 'Competitor Y raised prices.', provider: 'mock', costEstimate: 0 };
    if (system?.includes('yes') && system?.includes('no')) return { text: 'no', provider: 'mock', costEstimate: 0 };
    return { text: 'unused', provider: 'mock', costEstimate: 0 };
  });
  const run = await workflowEngine.runWorkflow(definition.id);
  restore();
  assert.strictEqual(run.status, 'done', 'an installed sample workflow should genuinely run, not just exist as stored data');
  console.log('✓ installing a workflow from the registry produces a genuinely runnable workflow definition');

  const leadEntry = registry.getDetails('lead-research-outreach-loop');
  const leadDefinition = { ...definition, id: uuid(), name: leadEntry.name, graph: leadEntry.graph };
  await memory.saveWorkflowDefinition(leadDefinition);
  const restoreLead = stub(async ({ prompt }) => {
    if ((prompt || '').includes('draft a short, genuinely personalized outreach email')) {
      return { text: JSON.stringify({ to: 'lead@example.com', subject: 'Hi', body: 'Intro message.' }), provider: 'mock', costEstimate: 0 };
    }
    return { text: 'Acme Corp\nBeta Inc\nGamma LLC', provider: 'mock', costEstimate: 0 };
  });
  const leadRun = await workflowEngine.runWorkflow(leadDefinition.id);
  restoreLead();
  assert.strictEqual(leadRun.status, 'done');
  const outreachTasks = (await memory.listTasks()).filter((t) => t.instruction?.includes('Send outreach email'));
  assert.strictEqual(outreachTasks.length, 3, 'should create one approval-gated task per lead');
  assert(outreachTasks.every((t) => t.status === 'pending_approval'), 'every outreach task must wait for approval, never auto-send');
  console.log('✓ the lead-outreach sample installs and runs correctly, creating real approval-gated tasks per lead');

  console.log('\nAll workflow marketplace checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
