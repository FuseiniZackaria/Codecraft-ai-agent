// A skill made with Claude (a folder with SKILL.md, no manifest.json) installs
// as a "guidance" skill: its instructions reach agent prompts only when a task
// mentions its trigger words, and any scripts in the folder never run.

process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Manifest, ManifestError, parseFrontmatter } = require('../core/installer/Manifest');
const { Installer } = require('../core/installer/Installer');
const { SkillManager } = require('../core/installer/SkillManager');
const guidanceRegistry = require('../core/guidanceRegistry');

function makeSkill(dirName, skillMd, extra = {}) {
  const dir = path.join(os.tmpdir(), `cc-claude-skill-${dirName}-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
  for (const [name, body] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

async function main() {
  // --- Header parsing: plain, quoted, folded blocks, lists, nested metadata ---
  const h = parseFrontmatter([
    '---',
    'name: invoice-writer',
    'description: >',
    '  Writes clear invoices.',
    '  Use when the user asks for an invoice.',
    'metadata:',
    '  version: "2.1.0"',
    '  triggers: [invoice, receipt]',
    'allowed-tools:',
    '  - Read',
    '  - Write',
    '---',
    '# Invoice writer',
  ].join('\r\n'));
  assert.strictEqual(h.name, 'invoice-writer');
  assert.strictEqual(h.description, 'Writes clear invoices. Use when the user asks for an invoice.');
  assert.deepStrictEqual(h.metadata, { version: '2.1.0', triggers: ['invoice', 'receipt'] });
  assert.deepStrictEqual(h['allowed-tools'], ['Read', 'Write']);
  assert.strictEqual(parseFrontmatter('# no header'), null);
  console.log('✓ SKILL.md header is read (quoted, folded, lists, nested, CRLF)');

  // --- Manifest from a Claude skill ---
  const m = Manifest.validate(Manifest.fromClaudeSkill('---\nname: brand-voice-guide\ndescription: "Our brand voice rules."\n---\nAlways be warm.'));
  assert.strictEqual(m.id, 'brand-voice-guide');
  assert.strictEqual(m.name, 'Brand Voice Guide');
  assert.strictEqual(m.kind, 'guidance');
  assert.strictEqual(m.guidanceFile, 'SKILL.md');
  assert.strictEqual(m.version, '1.0.0');
  assert.deepStrictEqual(m.permissions, [], 'no permissions - nothing runs');
  assert.ok(m.triggers.length > 0, 'never empty (empty = added to every prompt)');
  assert.ok(m.triggers.includes('brand') && m.triggers.includes('voice') && m.triggers.includes('brand voice guide'));
  const explicit = Manifest.fromClaudeSkill('---\nname: x-skill\ndescription: d\ntriggers: [tax, vat]\n---\n');
  assert.deepStrictEqual(explicit.triggers, ['tax', 'vat'], 'explicit triggers win');
  assert.throws(() => Manifest.fromClaudeSkill('no header here'), ManifestError);
  assert.throws(() => Manifest.fromClaudeSkill('---\ndescription: d\n---\n'), /missing "name"/);
  console.log('✓ a Claude skill becomes a guidance manifest with sensible triggers');

  // --- Folder with neither file: clear error ---
  const empty = path.join(os.tmpdir(), `cc-empty-skill-${process.pid}`);
  fs.mkdirSync(empty, { recursive: true });
  assert.throws(() => Manifest.load(empty), /manifest\.json \(or a Claude SKILL\.md\) not found/);
  console.log('✓ a folder with neither file gives a clear error');

  // --- Real install end to end; scripts are copied but never run ---
  const marker = path.join(os.tmpdir(), `cc-claude-skill-ran-${process.pid}`);
  fs.rmSync(marker, { force: true });
  const dir = makeSkill('invoice', [
    '---',
    'name: invoice-writer-test',
    'description: Writes clear invoices for small businesses.',
    '---',
    '# Invoice writer',
    'Always show the due date in bold.',
  ].join('\n'), { 'scripts/make.js': `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');` });

  const installer = new Installer();
  const skills = new SkillManager();
  try { await skills.remove('invoice-writer-test'); } catch { /* not installed */ }
  const result = await installer.install(dir, { approvedPermissions: [] });
  assert.strictEqual(result.skill.id, 'invoice-writer-test');
  const g = guidanceRegistry.relevantGuidance('Please write an invoice for the bakery order');
  assert.ok(g.some((x) => x.content.includes('Always show the due date in bold.')), 'reaches prompts when a trigger word matches');
  assert.ok(!guidanceRegistry.relevantGuidance('Plan a social media post').some((x) => x.content.includes('due date in bold')), 'not added to unrelated tasks');
  assert.ok(!fs.existsSync(marker), 'scripts in the skill folder never run');
  await skills.remove('invoice-writer-test');
  assert.ok(!guidanceRegistry.relevantGuidance('write an invoice').some((x) => x.content.includes('due date in bold')), 'gone after remove');
  console.log('✓ a Claude skill folder installs, applies only to matching tasks, and removes cleanly');

  // --- Existing manifest.json skills are unchanged (manifest.json wins over SKILL.md) ---
  const both = makeSkill('both', '---\nname: from-skill-md\ndescription: d\n---\n', {
    'manifest.json': JSON.stringify({ id: 'from-manifest', name: 'From manifest', version: '1.0.0', kind: 'guidance', guidanceFile: 'SKILL.md', triggers: ['x'] }),
  });
  assert.strictEqual(Manifest.load(both).id, 'from-manifest');
  console.log('✓ a manifest.json still takes priority');

  console.log('\nclaude-skill-install: all checks passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
