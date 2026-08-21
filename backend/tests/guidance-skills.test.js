const assert = require('assert');
const { SkillManager } = require('../core/installer/SkillManager');
const { Manifest } = require('../core/installer/Manifest');
const guidanceRegistry = require('../core/guidanceRegistry');
const toolRegistry = require('../tools/ToolRegistry');
const mockProvider = require('../core/providers/mockProvider');
const BaseAgent = require('../agents/base/BaseAgent');

async function run() {
  // --- Manifest validation ---
  assert.throws(
    () => Manifest.validate({ id: 'x', name: 'X', version: '1.0.0' }),
    /entry.*required when kind is "tool"/,
    'tool kind without entry should be rejected'
  );
  assert.throws(
    () => Manifest.validate({ id: 'x', name: 'X', version: '1.0.0', kind: 'guidance' }),
    /guidanceFile.*required when kind is "guidance"/,
    'guidance kind without guidanceFile should be rejected'
  );
  assert.throws(
    () => Manifest.validate({ id: 'x', name: 'X', version: '1.0.0', kind: 'nonsense', entry: 'a.js' }),
    /Invalid kind/,
    'an unrecognized kind should be rejected'
  );
  const defaulted = Manifest.validate({ id: 'x', name: 'X', version: '1.0.0', entry: 'a.js' });
  assert.strictEqual(defaulted.kind, 'tool', 'kind should default to "tool" when omitted, for backward compatibility');
  const guidanceManifest = Manifest.validate({
    id: 'y', name: 'Y', version: '1.0.0', kind: 'guidance', guidanceFile: 'g.md', triggers: ['css'],
  });
  assert.strictEqual(guidanceManifest.entry, null, 'guidance manifests should carry no entry');
  assert.deepStrictEqual(guidanceManifest.triggers, ['css']);
  console.log('✓ manifest validation correctly enforces required fields per kind');

  // --- Real install: guidance skill goes to GuidanceRegistry, not ToolRegistry ---
  const mgr = new SkillManager();
  const result = await mgr.installer.install('registry:ui-guidance', { approvedPermissions: [] });
  assert.strictEqual(result.skill.manifest.kind, 'guidance');
  assert.strictEqual(result.activated.guidance, true);
  assert.strictEqual(result.activated.tools.length, 0, 'a guidance skill should register zero callable tools');
  assert(guidanceRegistry.list().some((g) => g.id === 'ui-guidance'), 'should be registered in GuidanceRegistry');
  assert(!toolRegistry.list().some((t) => t.startsWith('ui-guidance.')), 'should NOT be registered as a callable tool');
  console.log('✓ a real guidance skill installs into GuidanceRegistry, never ToolRegistry');

  // --- Existing tool-kind skill still works (no regression from the new branch) ---
  const toolResult = await mgr.installer.install('registry:greeting-skill', { approvedPermissions: [] });
  assert.strictEqual(toolResult.skill.manifest.kind, 'tool');
  assert(toolRegistry.list().includes('greeting-skill.sayHello'), 'tool-kind skills should still register real tools');
  assert(!guidanceRegistry.list().some((g) => g.id === 'greeting-skill'));
  console.log('✓ existing tool-kind skills are unaffected (no regression)');

  // --- Real prompt injection: relevant vs irrelevant ---
  let capturedSystem = null;
  const originalComplete = mockProvider.complete;
  mockProvider.complete = async ({ system }) => {
    capturedSystem = system;
    return { text: 'ok', provider: 'mock', costEstimate: 0 };
  };
  const agent = new BaseAgent({ key: 'test-agent', role: 'Designer', tools: [] });
  const task = { id: 'task-guidance-test', instruction: 'n/a' };

  await agent.execute({ type: 'llm_call', instruction: 'Build a signup form with a submit button' }, task);
  assert(capturedSystem.includes('UI/UX Design Guidance'), 'a UI-related instruction should genuinely receive the guidance');
  assert(capturedSystem.includes('44x44px touch targets'), 'the real rule content, not just a label, should reach the prompt');

  await agent.execute({ type: 'llm_call', instruction: 'Summarize last quarter revenue trends' }, task);
  assert(!capturedSystem.includes('UI/UX Design Guidance'), 'an unrelated instruction should NOT receive the guidance');
  mockProvider.complete = originalComplete;
  console.log('✓ guidance genuinely reaches the agent prompt only when the task is actually relevant');

  // --- Full lifecycle: disable removes it live, enable restores it, remove deletes it ---
  assert(guidanceRegistry.list().some((g) => g.id === 'ui-guidance'));
  await mgr.disable('ui-guidance');
  assert(!guidanceRegistry.list().some((g) => g.id === 'ui-guidance'), 'disable should remove it from the live registry');
  await mgr.enable('ui-guidance');
  assert(guidanceRegistry.list().some((g) => g.id === 'ui-guidance'), 'enable should restore it');
  await mgr.remove('ui-guidance');
  assert(!guidanceRegistry.list().some((g) => g.id === 'ui-guidance'), 'remove should delete it permanently');
  await mgr.remove('greeting-skill');
  console.log('✓ full lifecycle (disable/enable/remove) works correctly for guidance skills');

  console.log('\nAll guidance-skill checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
