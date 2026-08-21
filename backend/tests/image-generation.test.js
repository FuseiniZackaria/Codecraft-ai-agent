const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.OPENAI_API_KEY = 'test-key-123';

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const orchestrator = require('../core/orchestrator');
const mockProvider = require('../core/providers/mockProvider');
const { resolveSafePath, WORKSPACE_ROOT } = require('../plugins/filesystem/workspaceSafety');

function stubFetch(responder) {
  const original = global.fetch;
  global.fetch = responder;
  return () => { global.fetch = original; };
}

function stubProvider(responder) {
  const original = mockProvider.complete;
  mockProvider.complete = responder;
  return () => { mockProvider.complete = original; };
}

async function main() {
  loadPlugins();

  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await toolRegistry.call('filesystem.writeFile', { projectId: 'imagegen-test', path: 'test.png', content: tinyPng, encoding: 'base64' }, { role: 'test' });
  const written = fs.readFileSync(resolveSafePath('imagegen-test', 'test.png'));
  assert(written.equals(Buffer.from(tinyPng, 'base64')), 'base64-encoded content should write byte-exact');
  assert.strictEqual(written[0], 0x89, 'should be a real, valid PNG (magic byte check)');

  await toolRegistry.call('filesystem.writeFile', { projectId: 'imagegen-test', path: 'test.txt', content: 'hello world' }, { role: 'test' });
  const textWritten = fs.readFileSync(resolveSafePath('imagegen-test', 'test.txt'), 'utf-8');
  assert.strictEqual(textWritten, 'hello world', 'existing text-mode writeFile calls must be unaffected');
  fs.rmSync(path.join(WORKSPACE_ROOT, 'imagegen-test'), { recursive: true, force: true });
  console.log('✓ writeFile writes byte-exact binary content with encoding, and text-mode calls are unaffected');

  let capturedRequest = null;
  let restoreFetch = stubFetch(async (url, options) => {
    capturedRequest = { url, options };
    return { ok: true, json: async () => ({ data: [{ b64_json: Buffer.from('fake-png-bytes').toString('base64'), revised_prompt: 'A refined prompt' }] }) };
  });
  const result1 = await toolRegistry.call('imagegen.generateImage', { prompt: 'A sunset over mountains', projectId: 'imagegen-test2', path: 'cover.png' }, { role: 'test' });
  assert.strictEqual(capturedRequest.url, 'https://api.openai.com/v1/images/generations');
  assert.strictEqual(capturedRequest.options.headers.Authorization, 'Bearer test-key-123');
  const body = JSON.parse(capturedRequest.options.body);
  assert.strictEqual(body.model, 'gpt-image-1');
  assert.strictEqual(body.prompt, 'A sunset over mountains');
  assert.strictEqual(result1.revisedPrompt, 'A refined prompt');
  assert.strictEqual(fs.readFileSync(resolveSafePath('imagegen-test2', 'cover.png'), 'utf-8'), 'fake-png-bytes');
  restoreFetch();
  console.log('✓ generateImage sends the correct real API request and saves the b64_json response correctly');

  restoreFetch = stubFetch(async (url) => {
    if (url === 'https://api.openai.com/v1/images/generations') return { ok: true, json: async () => ({ data: [{ url: 'https://example.com/generated.png' }] }) };
    if (url === 'https://example.com/generated.png') return { ok: true, arrayBuffer: async () => Buffer.from('downloaded-bytes') };
  });
  await toolRegistry.call('imagegen.generateImage', { prompt: 'test', projectId: 'imagegen-test2', path: 'cover2.png' }, { role: 'test' });
  assert.strictEqual(fs.readFileSync(resolveSafePath('imagegen-test2', 'cover2.png'), 'utf-8'), 'downloaded-bytes');
  restoreFetch();
  console.log('✓ generateImage correctly handles the url-response fallback shape (downloads and saves it)');

  restoreFetch = stubFetch(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid prompt content' } }) }));
  await assert.rejects(
    toolRegistry.call('imagegen.generateImage', { prompt: 'test', projectId: 'imagegen-test2', path: 'x.png' }, { role: 'test' }),
    /Invalid prompt content/
  );
  restoreFetch();
  console.log('✓ a real API error surfaces clearly, not a generic failure');

  fs.rmSync(path.join(WORKSPACE_ROOT, 'imagegen-test2'), { recursive: true, force: true });

  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve('../config')];
  delete require.cache[require.resolve('../plugins/imagegen/actions/generateImage.js')];
  const freshAction = require('../plugins/imagegen/actions/generateImage.js');
  await assert.rejects(freshAction.run({ prompt: 'test', projectId: 'x', path: 'x.png' }), /OPENAI_API_KEY/);
  console.log('✓ generateImage refuses clearly when no key is configured');

  process.env.OPENAI_API_KEY = 'test-key-123';
  delete require.cache[require.resolve('../config')];

  restoreFetch = stubFetch(async (url, options) => {
    if (url === 'https://api.openai.com/v1/images/generations') {
      const b = JSON.parse(options.body);
      global.__capturedImagePrompt = b.prompt;
      return { ok: true, json: async () => ({ data: [{ b64_json: Buffer.from('fake-image-bytes').toString('base64'), revised_prompt: `A vivid rendering of: ${b.prompt}` }] }) };
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });
  let restoreProvider = stubProvider(async ({ prompt }) => {
    if ((prompt || '').includes('image generation prompt')) {
      return { text: 'A cozy bakery storefront at golden hour, warm lighting, pastries in the window.', provider: 'mock', costEstimate: 0 };
    }
    return { text: 'Some generated content', provider: 'mock', costEstimate: 0 };
  });

  const [task] = await orchestrator.submitGoal('Create a campaign for my bakery');
  assert.strictEqual(task.status, 'done');
  const finalDoc = task.result[task.result.length - 1].text;
  assert(finalDoc.includes('## Cover Image'), 'final document should include a Cover Image section');
  assert(finalDoc.includes('A vivid rendering of'), 'final document should include the revised prompt');
  assert(finalDoc.includes(`/api/workspace/content-studio-${task.id}/file/cover.png`), 'final document should include a working file URL');
  assert(global.__capturedImagePrompt.includes('cozy bakery storefront'), 'the image prompt must come from the dedicated imagePrompt step, not the raw task instruction');

  const projectId = `content-studio-${task.id}`;
  assert.strictEqual(fs.readFileSync(path.join(WORKSPACE_ROOT, projectId, 'cover.png'), 'utf-8'), 'fake-image-bytes');
  fs.rmSync(path.join(WORKSPACE_ROOT, projectId), { recursive: true, force: true });
  restoreFetch();
  restoreProvider();
  console.log('✓ full Content Studio pipeline generates a real image, threads the correct prompt, and links to it');

  console.log('\nAll image generation checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
