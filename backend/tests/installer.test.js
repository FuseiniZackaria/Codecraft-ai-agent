const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Installer } = require('../core/installer/Installer');
const { SkillManager } = require('../core/installer/SkillManager');
const { detectSource } = require('../core/installer/SourceDetector');
const { PermissionManager, PermissionDeniedError } = require('../core/installer/PermissionManager');
const { DependencyResolver, CircularDependencyError } = require('../core/installer/DependencyResolver');
const toolRegistry = require('../tools/ToolRegistry');
const memory = require('../memory');

async function main() {
  assert.deepStrictEqual(detectSource('marketing-agent'), { type: 'registry', id: 'marketing-agent' });
  assert.deepStrictEqual(detectSource('registry:marketing-agent'), { type: 'registry', id: 'marketing-agent' });
  assert.deepStrictEqual(detectSource('github:user/marketing-agent'), { type: 'github', repo: 'user/marketing-agent' });
  assert.deepStrictEqual(detectSource('https://github.com/user/marketing-agent'), { type: 'github', repo: 'user/marketing-agent' });
  assert.strictEqual(detectSource('./marketing-agent').type, 'local');
  assert.strictEqual(detectSource('https://x.com/skill.zip').type, 'zip-url');
  console.log('✓ SourceDetector correctly classifies every spec example');

  const installer = new Installer();
  const skillManager = new SkillManager();

  try { await skillManager.remove('greeting-skill'); } catch { /* not installed, fine */ }

  const result = await installer.install('registry:greeting-skill', { approvedPermissions: [] });
  assert.strictEqual(result.skill.id, 'greeting-skill');
  assert(toolRegistry.has('greeting-skill.sayHello'), 'tool should be registered after install');
  const callResult = await toolRegistry.call('greeting-skill.sayHello', { name: 'Test' });
  assert(callResult.message.includes('Test'), 'dynamically loaded tool should actually run');
  console.log('✓ full install pipeline runs end to end and the installed tool actually executes');

  await assert.rejects(
    () => installer.install('registry:greeting-skill', { approvedPermissions: [] }),
    /already installed/
  );
  console.log('✓ duplicate install is rejected');

  await skillManager.disable('greeting-skill');
  assert(!toolRegistry.has('greeting-skill.sayHello'), 'tool should be gone after disable');
  await skillManager.enable('greeting-skill');
  assert(toolRegistry.has('greeting-skill.sayHello'), 'tool should be back after enable');
  console.log('✓ disable/enable correctly registers and unregisters the tool');

  const skillPath = (await memory.getSkill('greeting-skill')).sourcePath;
  await skillManager.remove('greeting-skill');
  assert(!toolRegistry.has('greeting-skill.sayHello'));
  assert(!fs.existsSync(skillPath), 'skill files should be deleted on remove');
  assert.strictEqual(await memory.getSkill('greeting-skill'), null);
  console.log('✓ remove fully cleans up tool registration, files, and persisted record');

  const pm = new PermissionManager();
  assert.throws(() => pm.validate(['internet', 'filesystem'], ['internet']), PermissionDeniedError);
  console.log('✓ permission validation rejects unapproved permissions');

  const dr = new DependencyResolver();
  assert.throws(() => dr.checkCircular('a', ['a', 'b']), CircularDependencyError);
  console.log('✓ circular dependency detection works');

  const brokenDir = path.join(require('os').tmpdir(), 'installer-test-broken-entry');
  fs.rmSync(brokenDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(brokenDir, 'agent'), { recursive: true });
  fs.writeFileSync(
    path.join(brokenDir, 'manifest.json'),
    JSON.stringify({
      id: 'broken-entry-test-skill',
      name: 'Broken',
      version: '1.0.0',
      entry: 'agent/index.js',
      dependencies: [],
      permissions: [],
    })
  );
  fs.writeFileSync(path.join(brokenDir, 'agent', 'index.js'), 'throw new Error("intentionally broken");');

  await assert.rejects(() => installer.install(brokenDir, { approvedPermissions: [] }), /intentionally broken/);
  const skillsDir = path.join(__dirname, '..', 'skills');
  const leftoverFiles = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : [];
  assert(!leftoverFiles.includes('broken-entry-test-skill'), 'failed install must not leave files behind');
  assert.strictEqual(await memory.getSkill('broken-entry-test-skill'), null, 'failed install must not leave a persisted record');
  fs.rmSync(brokenDir, { recursive: true, force: true });
  console.log('✓ a package that fails at activation is fully rolled back (files AND persisted record)');

  console.log('\nAll installer integration checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
