// Deliberately a separate file/process from image-generation.test.js.
// ContentStudioAgent captures its own `config` reference once, at its
// first require - if OPENAI_API_KEY were ever set earlier in the SAME
// process (even briefly, even if later deleted), that reference would
// permanently reflect the key having been present. Running this in total
// isolation, with the key never set at all, is the only reliable way to
// prove the graceful-skip path.
const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const orchestrator = require('../core/orchestrator');
const mockProvider = require('../core/providers/mockProvider');

async function main() {
  assert(!process.env.OPENAI_API_KEY, 'this test must run with OPENAI_API_KEY unset for the isolation to be meaningful');

  loadPlugins();
  const original = mockProvider.complete;
  mockProvider.complete = async () => ({ text: 'Some generated content', provider: 'mock', costEstimate: 0 });

  const [task] = await orchestrator.submitGoal('Create a campaign for my bakery');
  mockProvider.complete = original;

  assert.strictEqual(task.status, 'done', 'Content Studio must complete successfully without an image key configured');
  const finalDoc = task.result[task.result.length - 1].text;
  assert(!finalDoc.includes('## Cover Image'), 'no image section should appear when the key is not configured');
  console.log('✓ Content Studio gracefully skips image generation entirely when no key is configured, same as Tavily');

  console.log('\nAll no-key Content Studio checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
