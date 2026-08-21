const assert = require('assert');
const fs = require('fs');

process.env.YOUTUBE_API_KEY = 'test-yt-key';
process.env.COMPOSIO_API_KEY = 'test-composio-key';

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const composio = require('../core/composio');

async function main() {
  loadPlugins();

  const testFilePath = '/tmp/upload-test.mp4';
  fs.writeFileSync(testFilePath, 'fake video bytes');

  const originalExecute = composio.execute;
  const originalUploadFile = composio.uploadFile;
  let capturedUpload = null;
  let capturedExecute = null;

  composio.uploadFile = async (filePath, actionSlug, toolkitSlug) => {
    capturedUpload = { filePath, actionSlug, toolkitSlug };
    return { name: 'video.mp4', mimetype: 'video/mp4', s3key: 'staged-abc123' };
  };
  composio.execute = async (actionSlug, args, toolkitSlug) => {
    capturedExecute = { actionSlug, args, toolkitSlug };
    return { id: 'yt-video-123', videoId: 'yt-video-123' };
  };

  const result = await toolRegistry.call('youtube.upload', { filePath: testFilePath, title: 'My daily video', description: 'A description' }, { role: 'test' });
  assert.strictEqual(capturedUpload.filePath, testFilePath, 'the file should be staged with the correct path');
  assert.strictEqual(capturedUpload.actionSlug, 'YOUTUBE_MULTIPART_UPLOAD_VIDEO');
  assert.strictEqual(capturedUpload.toolkitSlug, 'youtube');
  assert.strictEqual(capturedExecute.actionSlug, 'YOUTUBE_MULTIPART_UPLOAD_VIDEO');
  assert.strictEqual(capturedExecute.args.file.s3key, 'staged-abc123', 'execute must receive the STAGED file descriptor, not the raw path');
  assert.strictEqual(capturedExecute.args.title, 'My daily video');
  assert.strictEqual(capturedExecute.args.privacyStatus, 'unlisted', 'must default to unlisted, not public, as a safety default');
  assert.strictEqual(result.status, 'uploaded');
  console.log('✓ upload correctly stages the file first, then references the staged descriptor, defaulting to unlisted');

  await toolRegistry.call('youtube.upload', { filePath: testFilePath, title: 'test', privacyStatus: 'public' }, { role: 'test' });
  assert.strictEqual(capturedExecute.args.privacyStatus, 'public', 'an explicit privacyStatus should override the default');
  console.log('✓ an explicit privacyStatus correctly overrides the default');

  await assert.rejects(toolRegistry.call('youtube.upload', { filePath: testFilePath }, { role: 'test' }), /"title"/);
  console.log('✓ upload validates that title is required');

  let uploadCalled = false;
  composio.uploadFile = async () => {
    uploadCalled = true;
    return {};
  };
  await assert.rejects(toolRegistry.call('youtube.upload', { filePath: '/does/not/exist.mp4', title: 'test' }, { role: 'test' }), /File not found/);
  assert.strictEqual(uploadCalled, false, 'a missing file must fail before ever staging or uploading to Composio');
  console.log('✓ a missing file fails clearly without ever calling Composio');

  composio.execute = originalExecute;
  composio.uploadFile = originalUploadFile;
  fs.rmSync(testFilePath);

  console.log('\nAll YouTube upload checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
