const assert = require('assert');
process.env.API_CONNECTOR_BASE_URL = 'https://registry.npmjs.org';

const { loadPlugins } = require('../core/pluginLoader');
loadPlugins();
const memory = require('../memory');
const { SkillManager } = require('../core/installer/SkillManager');
const toolRegistry = require('../tools/ToolRegistry');
const BaseAgent = require('../agents/base/BaseAgent');

async function run() {
  const mgr = new SkillManager();

  const result = await mgr.installer.install('registry:api-connector', { approvedPermissions: ['network'] });
  assert.strictEqual(result.skill.manifest.kind, 'tool');
  assert(toolRegistry.has('api-connector.get') && toolRegistry.has('api-connector.call'));
  assert.strictEqual(toolRegistry.isIrreversible('api-connector.get'), false, 'reads should never require approval');
  assert.strictEqual(toolRegistry.isIrreversible('api-connector.call'), true, 'writes must always require approval - a generic connector has no way to know which endpoints are safe');
  console.log('✓ the connector installs with reads unrestricted and writes gated, correctly');

  // --- Real call against a real, live external API ---
  const pkgResult = await toolRegistry.call('api-connector.get', { path: '/express' }, {});
  assert.strictEqual(pkgResult.status, 200);
  assert.strictEqual(pkgResult.data.name, 'express');
  assert(Object.keys(pkgResult.data.versions || {}).length > 50, 'this should be real, live registry data, not a stub');
  console.log('✓ a real GET against a live external API returns real data');

  await assert.rejects(
    () => toolRegistry.call('api-connector.get', { path: '/this-genuinely-does-not-exist-xyz-package' }, {}),
    (err) => err.message.includes('404') || err.message.includes('Not found'),
    'a real 404 from the external API should surface as a real error, not be swallowed'
  );
  console.log('✓ a real error from the external API is correctly surfaced, not swallowed');

  // --- Safety: an agent referencing the write-capable tool must be deferred ---
  const agent = new BaseAgent({ key: 'test-agent', role: 'Tester', tools: ['api-connector.call'] });
  const task = { id: 'api-connector-safety-task', instruction: 'test' };
  await memory.saveTask(task);
  const callResult = await agent.execute({ type: 'tool_call', tool: 'api-connector.call', args: { method: 'POST', path: '/some-write-endpoint' } }, task);
  assert.strictEqual(callResult.deferred, true, 'a write-capable call must be deferred to approval, never executed directly');
  const approvalTask = await memory.getTask(callResult.approvalTaskId);
  assert.strictEqual(approvalTask.status, 'pending_approval');
  console.log('✓ an agent referencing the write-capable tool is deferred to approval, never executed directly');

  // --- Reads stay frictionless for the same agent type ---
  const readAgent = new BaseAgent({ key: 'test-agent-2', role: 'Tester', tools: ['api-connector.get'] });
  const readTask = { id: 'api-connector-read-task', instruction: 'test' };
  await memory.saveTask(readTask);
  const readResult = await readAgent.execute({ type: 'tool_call', tool: 'api-connector.get', args: { path: '/express' } }, readTask);
  assert.strictEqual(readResult.data.name, 'express', 'reads should execute immediately with real data, no approval friction');
  console.log('✓ read-only calls execute immediately with real data - no unnecessary approval friction');

  await mgr.remove('api-connector');
  console.log('\nAll API connector checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
