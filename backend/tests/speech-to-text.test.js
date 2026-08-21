const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.OPENAI_API_KEY = 'test-key';

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const { resolveSafePath, WORKSPACE_ROOT } = require('../plugins/filesystem/workspaceSafety');

function stubFetch(responder) {
  const original = global.fetch;
  global.fetch = responder;
  return () => { global.fetch = original; };
}

async function main() {
  loadPlugins();

  const testVideoPath = path.join(os.tmpdir(), 'test-video.mp4');
  fs.writeFileSync(testVideoPath, 'fake video bytes for testing');

  let capturedRequest = null;
  let restore = stubFetch(async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      json: async () => ({
        text: 'Hello, this is a test video about baking bread.',
        duration: 5.2,
        segments: [
          { start: 0.0, end: 2.5, text: 'Hello, this is a test video' },
          { start: 2.5, end: 5.2, text: 'about baking bread.' },
        ],
      }),
    };
  });
  const result = await toolRegistry.call('speech.transcribe', { filePath: testVideoPath }, { role: 'test' });
  assert.strictEqual(capturedRequest.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.strictEqual(capturedRequest.options.headers.Authorization, 'Bearer test-key');
  assert(capturedRequest.options.body instanceof FormData, 'body must be real multipart FormData, not JSON');
  assert.strictEqual(result.text, 'Hello, this is a test video about baking bread.');
  assert.strictEqual(result.duration, 5.2);
  console.log('✓ transcribe sends a correct real multipart request and parses the response correctly');

  const srtLines = result.srt.trim().split('\n');
  assert.strictEqual(srtLines[0], '1', 'SRT should start with sequence number 1');
  assert.strictEqual(srtLines[1], '00:00:00,000 --> 00:00:02,500', 'SRT timestamp format must be exact');
  assert(result.srt.includes('\n2\n'), 'second segment should be sequence number 2');
  restore();
  console.log('✓ generated SRT output is genuinely valid (correct sequencing and timestamp format)');

  const bigFilePath = path.join(os.tmpdir(), 'big-video.mp4');
  fs.writeFileSync(bigFilePath, Buffer.alloc(26 * 1024 * 1024));
  await assert.rejects(toolRegistry.call('speech.transcribe', { filePath: bigFilePath }, { role: 'test' }), /25MB/);
  fs.rmSync(bigFilePath);
  console.log('✓ the real 25MB file size limit is enforced before ever calling the API');

  restore = stubFetch(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid file format' } }) }));
  await assert.rejects(toolRegistry.call('speech.transcribe', { filePath: testVideoPath }, { role: 'test' }), /Invalid file format/);
  restore();
  console.log('✓ a real API error surfaces clearly, not a generic failure');

  let apiCalled = false;
  restore = stubFetch(async () => {
    apiCalled = true;
    return { ok: true, json: async () => ({}) };
  });
  await assert.rejects(toolRegistry.call('speech.transcribe', { filePath: '/does/not/exist.mp4' }, { role: 'test' }), /File not found/);
  assert.strictEqual(apiCalled, false, 'a missing file must fail before ever calling the API (avoid wasting a call)');
  restore();
  console.log('✓ a nonexistent file fails clearly without ever calling the API');

  restore = stubFetch(async () => ({
    ok: true,
    json: async () => ({ text: 'Saved transcript test.', duration: 1.0, segments: [{ start: 0, end: 1, text: 'Saved transcript test.' }] }),
  }));
  const result6 = await toolRegistry.call('speech.transcribe', { filePath: testVideoPath, projectId: 'transcribe-test' }, { role: 'test' });
  assert(result6.srtPath, 'srtPath should be returned when projectId is given');
  assert.strictEqual(fs.readFileSync(resolveSafePath('transcribe-test', 'transcript.srt'), 'utf-8'), result6.srt);
  assert.strictEqual(fs.readFileSync(resolveSafePath('transcribe-test', 'transcript.txt'), 'utf-8'), 'Saved transcript test.');
  restore();
  fs.rmSync(path.join(WORKSPACE_ROOT, 'transcribe-test'), { recursive: true, force: true });
  console.log('✓ passing projectId saves real transcript.srt and transcript.txt files to the workspace');

  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve('../config')];
  delete require.cache[require.resolve('../plugins/speech/actions/transcribe.js')];
  const freshAction = require('../plugins/speech/actions/transcribe.js');
  await assert.rejects(freshAction.run({ filePath: testVideoPath }), /OPENAI_API_KEY/);
  console.log('✓ transcribe refuses clearly when no key is configured');

  fs.rmSync(testVideoPath);

  console.log('\nAll speech-to-text checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
