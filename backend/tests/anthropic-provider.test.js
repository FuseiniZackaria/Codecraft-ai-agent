// Claude (Anthropic) as the AI provider: AI_PROVIDER / ANTHROPIC_API_KEY pick
// it, the agents' complete() and Ian's tool loop both work on it, requests
// carry effort + the refusal fallback, cost is counted, and failures surface
// as a clear AI_UNAVAILABLE error instead of a hang. The SDK is faked - no
// network, no spend.

process.env.CC_TESTING = '1';
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

// --- Fake SDK: each call takes the next scripted turn ---
const script = [];
const requests = [];
const sdkPath = require.resolve('@anthropic-ai/sdk');
class FakeAnthropic {
  constructor(opts) {
    this.opts = opts;
    this.beta = {
      messages: {
        stream: (params) => {
          requests.push(JSON.parse(JSON.stringify(params)));
          const turn = script.shift();
          if (!turn) throw new Error('no scripted turn left');
          if (turn.error) {
            const err = new Error(turn.error.message);
            err.status = turn.error.status;
            return {
              async *[Symbol.asyncIterator]() { throw err; },
              finalMessage: async () => { throw err; },
            };
          }
          const final = {
            model: turn.model || params.model,
            stop_reason: turn.stop_reason || 'end_turn',
            content: turn.content,
            usage: turn.usage || { input_tokens: 100, output_tokens: 20 },
          };
          return {
            async *[Symbol.asyncIterator]() {
              for (const block of final.content) {
                if (block.type === 'text') yield { type: 'content_block_delta', delta: { type: 'text_delta', text: block.text } };
                if (block.type === 'tool_use') yield { type: 'content_block_start', content_block: block };
              }
            },
            finalMessage: async () => final,
          };
        },
      },
    };
  }
}
require(sdkPath);
require.cache[sdkPath].exports = FakeAnthropic;

function providerFor(env) {
  const out = execFileSync(process.execPath, ['-e', "process.stdout.write(require('./config').llm.provider)"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, AI_PROVIDER: '', ANTHROPIC_API_KEY: '', ...env },
  });
  return String(out);
}

async function main() {
  // --- Which provider is chosen ---
  assert.strictEqual(providerFor({ ANTHROPIC_API_KEY: 'sk-test' }), 'anthropic', 'an Anthropic key alone selects Claude');
  assert.strictEqual(providerFor({ ANTHROPIC_API_KEY: 'sk-test', AI_PROVIDER: 'gemini' }), 'gemini', 'AI_PROVIDER=gemini wins over the key');
  assert.strictEqual(providerFor({ AI_PROVIDER: ' Anthropic ' }), 'anthropic', 'AI_PROVIDER is trimmed and case-insensitive');
  console.log('  ok  provider selection');

  const config = require('../config');
  config.llm.provider = 'anthropic';
  config.llm.anthropicKey = 'sk-test';
  config.anthropic.model = 'claude-opus-5-5';
  config.anthropic.effort = 'low';
  config.assistant.dailyUsdCap = 0;

  const { availableProviders } = require('../core/router');
  assert.ok(availableProviders().includes('ai'), 'the real provider is available with an Anthropic key');
  config.llm.anthropicKey = null;
  assert.ok(!availableProviders().includes('ai'), 'no key, no real provider');
  config.llm.anthropicKey = 'sk-test';
  console.log('  ok  router');

  // --- Agents: complete() ---
  const aiProvider = require('../core/providers/aiProvider');
  script.push({
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"reply":"Good morning","hold":false}' }],
    usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
  });
  const res = await aiProvider.complete({ system: 'Be Ian', prompt: 'hi', maxTokens: 800, history: [{ role: 'assistant', content: 'earlier' }, { role: 'user', content: '' }] });
  assert.strictEqual(res.text, '{"reply":"Good morning","hold":false}', 'only text blocks, thinking skipped');
  assert.ok(Math.abs(res.costEstimate - 6.0) < 1e-9, `Opus 5.5: $4/M in + $20/M out = $6, got ${res.costEstimate}`);
  const req = requests.at(-1);
  assert.strictEqual(req.model, 'claude-opus-5-5');
  assert.deepStrictEqual(req.output_config, { effort: 'low' });
  assert.strictEqual(req.fallbacks, 'default');
  assert.deepStrictEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.ok(req.max_tokens >= 8000, 'room for thinking even when the caller asks for 800');
  assert.strictEqual(req.system, 'Be Ian');
  assert.deepStrictEqual(req.messages, [{ role: 'assistant', content: 'earlier' }, { role: 'user', content: 'hi' }], 'blank history dropped');
  console.log('  ok  agents complete() on Claude');

  // Images/PDFs sent as Gemini-style parts become Claude blocks.
  script.push({ content: [{ type: 'text', text: 'a receipt' }] });
  await aiProvider.complete({ content: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { inlineData: { mimeType: 'application/pdf', data: 'BBBB' } }, { text: 'what is this?' }] });
  assert.deepStrictEqual(requests.at(-1).messages[0].content.map((b) => b.type), ['image', 'document', 'text']);
  console.log('  ok  attachments');

  // Failures: a clear message, not a hang.
  script.push({ error: { status: 400, message: 'Your credit balance is too low to access the Anthropic API.' } });
  await assert.rejects(aiProvider.complete({ prompt: 'hi' }), /out of credit/);
  script.push({ error: { status: 529, message: 'Overloaded' } });
  await assert.rejects(aiProvider.complete({ prompt: 'hi' }), /overloaded/);
  console.log('  ok  failures are explained');

  // --- Ian: tool loop on Claude ---
  const { loadPlugins } = require('../core/pluginLoader');
  loadPlugins();
  const handlers = require('../core/assistant/handlers');
  const realInvoke = handlers.invoke;
  const toolCalls = [];
  handlers.invoke = async (name, input) => { toolCalls.push({ name, input }); return { ok: true, task_id: 'task-1' }; };
  // index.js destructured invoke at load time, so load it after the stub.
  delete require.cache[require.resolve('../core/assistant')];
  const { runAssistant } = require('../core/assistant');

  script.push({
    stop_reason: 'tool_use',
    content: [{ type: 'text', text: 'On it. ' }, { type: 'tool_use', id: 'tu_1', name: 'run_strategy_task', input: { instruction: 'Plan the launch' } }],
    usage: { input_tokens: 500, output_tokens: 50, cache_creation_input_tokens: 3000 },
  });
  script.push({ content: [{ type: 'text', text: 'Done - the plan is ready.' }], usage: { input_tokens: 600, output_tokens: 30, cache_read_input_tokens: 3000 } });

  const events = [];
  const result = await runAssistant({ message: 'Make me a launch plan', onEvent: (e) => events.push(e) });
  assert.strictEqual(result.reply, 'Done - the plan is ready.');
  assert.strictEqual(result.iterations, 2);
  assert.deepStrictEqual(toolCalls, [{ name: 'run_strategy_task', input: { instruction: 'Plan the launch' } }]);
  assert.ok(events.some((e) => e.type === 'tool_start' && e.name === 'run_strategy_task'));
  assert.ok(events.some((e) => e.type === 'tool_end'));
  assert.strictEqual(events.filter((e) => e.type === 'text_delta').map((e) => e.text).join(''), 'On it. Done - the plan is ready.');
  assert.strictEqual(result.usage.cache_read_input_tokens, 3000);

  const second = requests.at(-1);
  assert.strictEqual(second.system[0].cache_control.type, 'ephemeral', 'frozen system prompt is cached');
  assert.ok(!second.system[1].cache_control, 'per-request context sits after the cache breakpoint');
  assert.ok(second.tools.length > 0, 'tools sent for a real request');
  const last = second.messages.at(-1);
  assert.strictEqual(last.role, 'user');
  assert.strictEqual(last.content[0].type, 'tool_result');
  assert.strictEqual(last.content[0].tool_use_id, 'tu_1');
  assert.strictEqual(second.messages.at(-2).role, 'assistant', 'the tool_use turn is echoed back whole');
  console.log('  ok  Ian tool loop on Claude');

  // Greetings skip the tools.
  script.push({ content: [{ type: 'text', text: 'Hi! How can I help?' }] });
  await runAssistant({ message: 'hi' });
  assert.ok(!requests.at(-1).tools, 'no tools for small talk');
  console.log('  ok  small talk without tools');

  // Claude down: AI_UNAVAILABLE, so the chat route shows the reason.
  script.push({ error: { status: 401, message: 'invalid x-api-key' } });
  await assert.rejects(runAssistant({ message: 'hello there friend, plan my week' }), (err) => err.code === 'AI_UNAVAILABLE' && /API key/.test(err.message));
  console.log('  ok  Ian failure is reported');

  handlers.invoke = realInvoke;
  console.log('anthropic-provider: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
