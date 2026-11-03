// core/providers/gemini.js: fail fast and switch to the fallback model when the
// main one is rate-limited, overloaded or slow to start; give a clear error
// when both are down; never fall back on a non-retryable error (e.g. 400).

process.env.CC_TESTING = '1';
const assert = require('assert');

const behaviour = {}; // model -> 'ok' | 503 | 429 | 400 | 'hang'
const calls = [];

const sdkPath = require.resolve('@google/genai');
const realSdk = require(sdkPath);
class FakeGoogleGenAI {
  constructor() {
    this.models = {
      generateContentStream: async ({ model, config }) => {
        calls.push(model);
        const b = behaviour[model];
        if (typeof b === 'number') {
          const err = new Error(JSON.stringify({ error: { code: b, message: 'scripted' } }));
          err.status = b;
          throw err;
        }
        return (async function* () {
          if (b === 'hang') {
            await new Promise((resolve, reject) => config.abortSignal.addEventListener('abort', () => reject(new Error('aborted'))));
          }
          yield { candidates: [{ content: { role: 'model', parts: [{ text: `hello from ${model}` }] }, finishReason: 'STOP' }] };
        })();
      },
    };
  }
}
require.cache[sdkPath].exports = { ...realSdk, GoogleGenAI: FakeGoogleGenAI };

const config = require('../config');
config.llm.geminiKey = 'test-key';
config.llm.fallbackModel = 'lite';
config.llm.firstChunkTimeoutMs = 200;
config.llm.lastAttemptTimeoutMs = 400;
config.llm.cooldownMs = 60000;
const gemini = require('../core/providers/gemini');

async function text(model, { keepCooldown = false } = {}) {
  if (!keepCooldown) gemini.resetCooldowns();
  const { model: used, chunks, attempts } = await gemini.startStream({ model, contents: [], config: {} });
  let out = '';
  for await (const c of chunks) out += c.candidates[0].content.parts[0].text;
  return { used, out, attempts };
}

(async () => {
  Object.assign(behaviour, { main: 'ok', lite: 'ok' });
  let r = await text('main');
  assert.strictEqual(r.used, 'main');
  assert.strictEqual(r.out, 'hello from main');
  console.log('✓ healthy main model answers, no fallback');

  for (const failure of [503, 429]) {
    behaviour.main = failure;
    r = await text('main');
    assert.strictEqual(r.used, 'lite', `${failure} should switch to the fallback`);
    assert.deepStrictEqual(r.attempts.map((a) => a.status), [failure, 'ok']);
    console.log(`✓ ${failure} on the main model switches to the fallback`);
  }

  behaviour.main = 'hang';
  const t0 = Date.now();
  r = await text('main');
  assert.strictEqual(r.used, 'lite');
  assert.ok(Date.now() - t0 < 1500, 'a hanging model is abandoned at the first-chunk deadline');
  assert.strictEqual(r.attempts[0].status, 'timeout');
  console.log('✓ a model that does not start answering in time is abandoned for the fallback');

  calls.length = 0;
  const t1 = Date.now();
  r = await text('main', { keepCooldown: true });
  assert.deepStrictEqual(calls, ['lite'], 'the failed model goes last during its cooldown');
  assert.ok(Date.now() - t1 < 150, 'no second wait for the stuck model');
  console.log('✓ after a failure the main model is skipped for the cooldown (no repeated wait)');

  Object.assign(behaviour, { main: 429, lite: 429 });
  await assert.rejects(text('main'), (err) => err.code === 'GEMINI_UNAVAILABLE' && /rate limit/.test(err.message) && err.attempts.length === 2);
  console.log('✓ both models rate-limited -> clear GEMINI_UNAVAILABLE error, no long wait');

  Object.assign(behaviour, { main: 400, lite: 'ok' });
  calls.length = 0;
  await assert.rejects(text('main'));
  assert.deepStrictEqual(calls, ['main'], 'a bad request is not retried on another model');
  console.log('✓ a non-retryable error (400) is not retried on the fallback');

  Object.assign(behaviour, { main: 'ok', lite: 'ok' });
  calls.length = 0;
  await text('lite');
  assert.deepStrictEqual(calls, ['lite'], 'fallback equal to the main model is not tried twice');
  console.log('✓ no duplicate attempt when the main model is the fallback model');

  console.log('\ngemini-fallback tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
