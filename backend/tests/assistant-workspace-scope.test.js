// Running a task through Ian (the assistant): the task row and the usage row
// must carry the caller's workspace, nothing may leak to another workspace, and
// the whole path must work with WORKSPACE_GUARD_MODE=enforce (where any
// unscoped store write throws).

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.CC_TESTING = '1';
process.env.WORKSPACE_GUARD_MODE = 'enforce';

const assert = require('assert');

const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Scripted Gemini stream: turn 1 asks for a department task, turn 2 ends the conversation.
// Installed in place of the SDK's GoogleGenAI before the assistant module loads.
function installScriptedGemini(turns) {
  let call = 0;
  const sdkPath = require.resolve('@google/genai');
  const realSdk = require(sdkPath);
  class ScriptedGoogleGenAI {
    constructor() {
      this.models = {
        generateContentStream: async () => {
          const turn = turns[Math.min(call++, turns.length - 1)];
          return (async function* () {
            for (const part of turn.parts) yield { candidates: [{ content: { role: 'model', parts: [part] } }] };
            yield { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }], usageMetadata: turn.usage };
          })();
        },
      };
    }
  }
  require.cache[sdkPath].exports = { ...realSdk, GoogleGenAI: ScriptedGoogleGenAI };
}

async function main() {
  const config = require('../config');
  config.assistant.apiKey = 'test-key';
  config.assistant.dailyUsdCap = 0;

  const memory = require('../memory');
  const { readShadowLog, clearShadowLog } = require('../memory/workspaceGuard');
  const usage = require('../core/assistant/usage');
  installScriptedGemini([
    {
      usage: { promptTokenCount: 1000, candidatesTokenCount: 200 },
      parts: [{ functionCall: { id: 'fc_1', name: 'run_strategy_task', args: { instruction: 'Outline a launch plan for next month' } } }],
    },
    {
      usage: { promptTokenCount: 1500, candidatesTokenCount: 100 },
      parts: [{ text: 'Done - the plan is ready.' }],
    },
  ]);
  const { runAssistant } = require('../core/assistant');
  const { loadPlugins } = require('../core/pluginLoader');
  loadPlugins();

  config.assistant.model = 'gemini-3.8-flash';

  clearShadowLog();
  const result = await runAssistant({ message: 'Make me a launch plan', workspaceId: WS_A });
  assert.ok(result.reply.includes('Done'), 'assistant should finish the turn');
  assert.strictEqual(result.taskIds.length, 1, 'the department task should be reported back');

  // --- The task is stamped with the caller's workspace and invisible to others ---
  const task = await memory.getTask(result.taskIds[0]);
  assert.strictEqual(task.workspace_id, WS_A, 'task row must carry the caller\'s workspace');
  assert.strictEqual(task.status, 'done');
  assert.ok((await memory.listTasks({ workspaceId: WS_A })).some((t) => t.id === task.id));
  assert.ok(!(await memory.listTasks({ workspaceId: WS_B })).some((t) => t.id === task.id), 'another workspace must not see it');
  console.log('✓ Ian task is stamped with the caller\'s workspace and isolated from other workspaces (enforce mode)');

  // --- The usage row is stamped with the caller's workspace and kept per workspace ---
  await usage.flush(memory);
  const day = (await usage.getDaily(memory, WS_A)).day;
  const row = await memory.getAssistantUsage(day, { workspaceId: WS_A });
  assert.ok(row, 'a usage row must be saved for the caller\'s workspace');
  assert.strictEqual(row.workspace_id, WS_A);
  assert.ok(row.usd > 0 && row.input_tokens >= 2500 && row.output_tokens >= 300, `usage should be recorded: ${JSON.stringify(row)}`);
  assert.strictEqual(await memory.getAssistantUsage(day, { workspaceId: WS_B }), null, 'another workspace has no usage row');
  assert.strictEqual((await usage.getDaily(memory, WS_B)).usd, 0, 'another workspace\'s daily counter is untouched');
  console.log('✓ usage row is stamped with the caller\'s workspace and counted per workspace');

  // --- A second workspace gets its own row, not a shared one ---
  await runAssistant({ message: 'Another plan please', workspaceId: WS_B });
  await usage.flush(memory);
  const rowB = await memory.getAssistantUsage(day, { workspaceId: WS_B });
  assert.strictEqual(rowB.workspace_id, WS_B);
  assert.strictEqual((await memory.getAssistantUsage(day, { workspaceId: WS_A })).workspace_id, WS_A, 'workspace A\'s row is not overwritten');
  console.log('✓ each workspace keeps its own daily usage row');

  // --- Per-workspace cap: A hitting the cap does not block B ---
  config.assistant.dailyUsdCap = 0.0001;
  assert.strictEqual(await usage.isOverCap(memory, WS_A), true);
  const WS_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  assert.strictEqual(await usage.isOverCap(memory, WS_C), false, 'a fresh workspace is not blocked by another\'s spend');
  config.assistant.dailyUsdCap = 0;
  console.log('✓ the daily cap is enforced per workspace');

  // --- Ian cannot read another workspace's task ---
  const { invoke } = require('../core/assistant/handlers');
  const own = await invoke('check_task_result', { task_id: task.id }, { workspaceId: WS_A });
  assert.ok(own && own.ok !== false, 'the owning workspace can read its task');
  const foreign = await invoke('check_task_result', { task_id: task.id }, { workspaceId: WS_B });
  assert.strictEqual(foreign.ok, false, 'another workspace must get "not found"');
  console.log('✓ check_task_result does not leak another workspace\'s task');

  // --- Nothing in the whole path hit the guard unscoped ---
  const misses = readShadowLog().filter((e) => ['saveTask', 'updateTask', 'audit', 'addReflection', 'remember', 'upsertAssistantUsage'].includes(e.method));
  assert.deepStrictEqual(misses, [], `no unscoped store writes expected, got: ${JSON.stringify(misses)}`);
  console.log('✓ zero shadow-log misses across the whole Ian path');

  console.log('\nAll assistant workspace-scope checks passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ assistant-workspace-scope.test.js failed:', err);
  process.exit(1);
});
