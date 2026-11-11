// OpenAI is optional: only cover images use it. A missing key, a key that
// isn't an OpenAI key (e.g. a Google "AQ..." key), a rejected key or an
// account with no credit never fails a task - Content Studio still delivers
// the whole package with a friendly "cover image skipped" note, and a bad key
// is only tried once. Text (research, scripts, captions, retakes...) never
// touches OpenAI, and the video editor has no OpenAI calls at all.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.OPENAI_API_KEY = 'AQ.not-an-openai-key';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const orchestrator = require('../core/orchestrator');
const mockProvider = require('../core/providers/mockProvider');
const openaiKey = require('../core/openaiKey');

let openaiCalls = 0;
const realFetch = global.fetch;
let openaiAnswer = null;
global.fetch = async (url, options) => {
  if (String(url).includes('api.openai.com')) {
    openaiCalls += 1;
    return openaiAnswer();
  }
  return realFetch(url, options);
};
mockProvider.complete = async ({ prompt }) => ({
  text: (prompt || '').includes('image generation prompt') ? 'A warm bakery at sunrise, fresh bread in the window.' : 'Some generated content',
  provider: 'mock', costEstimate: 0,
});

const campaign = async () => {
  const [task] = await orchestrator.submitGoal('Create a campaign for my bakery');
  return { task, doc: task.result?.[task.result.length - 1]?.text || '' };
};

(async () => {
  loadPlugins();

  // 1. A Google key in the OpenAI slot: never sent to OpenAI; the package still arrives.
  {
    assert.strictEqual(openaiKey.status().usable, false);
    assert(/doesn't look like an OpenAI key/.test(openaiKey.status().reason));
    await assert.rejects(toolRegistry.call('imagegen.generateImage', { prompt: 'x', projectId: 'oa-test', path: 'x.png' }, { role: 'test' }), (e) => e.code === 'OPENAI_UNAVAILABLE');
    const { task, doc } = await campaign();
    assert.strictEqual(task.status, 'done', `the task completes: ${JSON.stringify(task.result)}`);
    assert(/## Research/.test(doc) && /## Hashtags/.test(doc), 'research, strategy, scripts, captions, hashtags all delivered');
    assert(/\*\*Cover image:\*\* skipped - OPENAI_API_KEY doesn't look like an OpenAI key/.test(doc), 'a friendly note instead of a failure');
    assert.strictEqual(openaiCalls, 0, 'nothing was sent to OpenAI');
    console.log('✓ a non-OpenAI key in OPENAI_API_KEY: the package is delivered with a "cover image skipped" note; OpenAI is never called');
  }

  // 2. A real-looking key that OpenAI rejects: the package still arrives, and the key is not tried again.
  {
    config.llm.openaiKey = 'sk-looks-real-but-wrong';
    openaiAnswer = () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key provided: sk-lo****rong.', code: 'invalid_api_key' } }) });
    let { task, doc } = await campaign();
    assert.strictEqual(task.status, 'done', 'an invalid key never fails the whole task');
    assert(/Cover image:\*\* skipped - OpenAI rejected the API key/.test(doc));
    assert(/paste this into any image tool/.test(doc), 'the image prompt is offered to use elsewhere');
    assert.strictEqual(openaiCalls, 1);
    ({ task, doc } = await campaign());
    assert.strictEqual(task.status, 'done');
    assert.strictEqual(openaiCalls, 1, 'a rejected key is remembered - not tried on every task');
    console.log('✓ "Incorrect API key provided": the task still completes with a note; the bad key is tried once, not every time');
  }

  // 3. No credit left counts as unusable too.
  {
    openaiKey._reset();
    assert.strictEqual(openaiKey.noteFailure(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }), true);
    assert(/no credit/.test(openaiKey.status().reason));
    assert.strictEqual(openaiKey.noteFailure(400, { error: { message: 'Invalid prompt content' } }), false, 'an ordinary error is not "bad key"');
    console.log('✓ "no credit" is treated like a bad key: images are skipped, nothing fails');
  }

  // 4. No key at all: the package still arrives (as before), with the note.
  {
    openaiKey._reset();
    config.llm.openaiKey = null;
    const { task, doc } = await campaign();
    assert.strictEqual(task.status, 'done');
    assert(!doc.includes('## Cover Image'));
    assert(/Cover image:\*\* skipped - no OpenAI key is set/.test(doc));
    console.log('✓ no OpenAI key: everything else is delivered, with a short note');
  }

  // 5. The video editor (backend + worker) has no OpenAI calls; its text runs on the main AI provider.
  {
    const root = path.join(__dirname, '..', '..');
    const files = [
      ...fs.readdirSync(path.join(root, 'backend/core/video')).map((f) => path.join(root, 'backend/core/video', f)),
      path.join(root, 'backend/api/videoRoutes.js'), path.join(root, 'backend/api/videoWorkerRoutes.js'),
      ...(fs.existsSync(path.join(root, 'worker/lib')) ? fs.readdirSync(path.join(root, 'worker/lib')).map((f) => path.join(root, 'worker/lib', f)) : []),
    ];
    for (const f of files) assert(!/openai/i.test(fs.readFileSync(f, 'utf8')), `${path.basename(f)} must not use OpenAI`);
    const media = fs.readFileSync(path.join(root, 'worker/lib/media.js'), 'utf8');
    assert(/'--engine', 'whisper'/.test(media), 'transcription: local Whisper only (never a paid engine)');
    console.log('✓ the video editor uses local Whisper and the main AI provider (Anthropic) only - no OpenAI anywhere');
  }

  // 6. Text: Anthropic whenever AI_PROVIDER=anthropic, or when it's unset and an Anthropic key exists.
  {
    const run = (env) => {
      const r = require('child_process').spawnSync(process.execPath, ['-e', "console.log(require('./config').llm.provider)"], {
        cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, ...env, DOTENV_CONFIG_PATH: 'nonexistent' },
      });
      return r.stdout.trim().split('\n').pop();
    };
    assert.strictEqual(run({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '' }), 'anthropic');
    assert.strictEqual(run({ AI_PROVIDER: '', ANTHROPIC_API_KEY: 'sk-ant-test' }), 'anthropic');
    console.log('✓ text tasks use Anthropic with AI_PROVIDER=anthropic (or an Anthropic key and no AI_PROVIDER)');
  }

  global.fetch = realFetch;
  console.log('\nAll OpenAI-optional checks passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
