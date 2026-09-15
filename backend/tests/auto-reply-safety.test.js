const assert = require('assert');

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const mockProvider = require('../core/providers/mockProvider');
const aiProvider = require('../core/providers/aiProvider');
const memory = require('../memory');
const config = require('../config');

function stubProvider(text) {
  const respond = async () => ({ text, provider: 'mock', costEstimate: 0 });
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = respond;
  aiProvider.complete = respond;
  return () => {
    mockProvider.complete = originalMock;
    aiProvider.complete = originalAi;
  };
}

function stubTool(name, fn) {
  const original = toolRegistry.tools.get(name);
  toolRegistry.register(name, { permission: name, irreversible: true, run: fn });
  return () => { if (original) toolRegistry.register(name, original); };
}

const SAMPLE_BUSINESS = {
  companyName: 'Acme Cafe',
  industry: 'Food & Beverage',
  targetMarket: '',
  description: 'A neighborhood cafe.',
  knownCompetitors: [],
  hours: 'Mon-Fri 8am-6pm, Sat-Sun 9am-4pm',
  location: '123 Main St',
  services: 'Coffee, pastries, light lunch',
  pricing: 'Coffee $3-5, pastries $2-4',
  policies: '',
  faq: [{ question: 'Do you have WiFi?', answer: 'Yes, free WiFi for customers.' }],
};

async function main() {
  loadPlugins();

  const { classifyReplySafety } = require('../core/autoReplySafety');
  const TelegramAgent = require('../agents/telegram/TelegramAgent');
  const agent = new TelegramAgent();

  const originalBusiness = { ...config.business };

  // === classifyReplySafety unit checks ===

  // Case 1: sensitive keyword in the CUSTOMER's message blocks it, regardless of the draft.
  Object.assign(config.business, SAMPLE_BUSINESS);
  let result = await classifyReplySafety({ channel: 'telegram', incomingMessage: 'I want a refund for my order', draftReply: 'Sure, happy to help!' });
  assert.strictEqual(result.safe, false);
  assert(result.reason.includes('refund'), `expected reason to mention "refund", got: ${result.reason}`);
  console.log('✓ classifyReplySafety: a risk-category keyword in the customer\'s message blocks auto-send regardless of business info');

  // Case 2: sensitive keyword in the DRAFT blocks it, even if the customer's message looks harmless.
  result = await classifyReplySafety({ channel: 'telegram', incomingMessage: 'What are your hours?', draftReply: 'We can offer a discount if you complain about it.' });
  assert.strictEqual(result.safe, false);
  assert(result.reason.includes('discount') || result.reason.includes('complain'));
  console.log('✓ classifyReplySafety: a risk-category keyword in the drafted reply also blocks auto-send');

  // Regression tests for a REAL bug: an actual customer received a
  // fabricated website URL and literal unfilled template brackets, both
  // incorrectly approved as "GROUNDED" by the LLM classifier alone.
  Object.assign(config.business, SAMPLE_BUSINESS);
  result = await classifyReplySafety({ channel: 'telegram', incomingMessage: 'Do you have a website?', draftReply: 'Here you go: www.ourbusiness.com' });
  assert.strictEqual(result.safe, false, 'a fabricated placeholder-style website must be blocked deterministically, not left to the LLM alone');
  console.log('✓ classifyReplySafety: REGRESSION - a fabricated placeholder website (www.ourbusiness.com) is deterministically blocked');

  result = await classifyReplySafety({ channel: 'telegram', incomingMessage: 'Tell me about your business', draftReply: 'We are a small team focused on [what you do], helping customers with [core benefit].' });
  assert.strictEqual(result.safe, false, 'literal unfilled template brackets must be deterministically blocked');
  console.log('✓ classifyReplySafety: REGRESSION - literal unfilled template placeholder brackets are deterministically blocked');

  // Case 3: NO business info configured at all - always routes to human, since there's nothing to ground an answer in.
  Object.keys(config.business).forEach((k) => { config.business[k] = Array.isArray(config.business[k]) ? [] : ''; });
  result = await classifyReplySafety({ channel: 'telegram', incomingMessage: 'What time do you open?', draftReply: 'We open at 9am!' });
  assert.strictEqual(result.safe, false);
  assert(result.reason.includes('No business info'));
  console.log('✓ classifyReplySafety: with no business info configured, defaults to human review rather than letting the AI guess');

  // Case 4: business info IS configured and the reply is genuinely grounded in it - passes.
  Object.assign(config.business, SAMPLE_BUSINESS);
  let restoreProvider = stubProvider('GROUNDED');
  result = await classifyReplySafety({ channel: 'telegram', incomingMessage: 'What are your hours?', draftReply: 'We are open Mon-Fri 8am-6pm and weekends 9am-4pm!' });
  restoreProvider();
  assert.strictEqual(result.safe, true, `expected safe=true, got reason: ${result.reason}`);
  console.log('✓ classifyReplySafety: a reply genuinely grounded in the provided business info passes');

  // Case 5: business info configured, but the classifier judges the reply NOT grounded (e.g. topic isn't covered) - blocked.
  restoreProvider = stubProvider('NOT_GROUNDED');
  result = await classifyReplySafety({ channel: 'telegram', incomingMessage: 'Do you cater weddings?', draftReply: 'Yes, we would love to cater your wedding!' });
  restoreProvider();
  assert.strictEqual(result.safe, false);
  console.log('✓ classifyReplySafety: a reply NOT grounded in the provided business info is routed to a human, even with business info present');

  // Case 6: a classifier failure fails CLOSED (routes to human), never open.
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = async () => { throw new Error('simulated provider outage'); };
  aiProvider.complete = async () => { throw new Error('simulated provider outage'); };
  result = await classifyReplySafety({ channel: 'telegram', incomingMessage: 'What are your hours?', draftReply: 'We are open Mon-Fri!' });
  mockProvider.complete = originalMock;
  aiProvider.complete = originalAi;
  assert.strictEqual(result.safe, false, 'a classifier failure must fail CLOSED, never open');
  console.log('✓ classifyReplySafety: a provider failure fails closed (routes to human), never open');

  // Case 7: the daily limit blocks further auto-sends once reached.
  const originalLimit = config.autoReply.dailyLimitPerChannel;
  config.autoReply.dailyLimitPerChannel = 1;
  const { v4: uuid } = require('uuid');
  await memory.saveTask({
    id: uuid(),
    agent: 'Telegram Agent',
    instruction: 'Reply on Telegram to some-chat',
    status: 'done',
    irreversible: true,
    toolCall: { tool: 'telegram.sendMessage', irreversible: true },
    payload: { to: 'some-chat', body: 'hi' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  result = await classifyReplySafety({ channel: 'telegram', incomingMessage: 'Hi', draftReply: 'Hello!' });
  config.autoReply.dailyLimitPerChannel = originalLimit;
  assert.strictEqual(result.safe, false);
  assert(result.reason.includes('Daily auto-reply limit'));
  console.log('✓ classifyReplySafety: the daily per-channel limit blocks further auto-sends once reached');

  // === TelegramAgent integration: feature flag gating ===

  // Case 8: auto-reply DISABLED (default) - task always stays pending, even for an obviously grounded message.
  config.autoReply.telegram.enabled = false;
  let sendCalled = false;
  let restoreSend = stubTool('telegram.sendMessage', async () => { sendCalled = true; return { status: 'sent' }; });
  let restoreProvider2 = stubProvider('We are open 9-5 Monday to Friday!');
  await agent.handleIncomingMessage({ from: 'chat-disabled', body: 'What are your hours?' });
  restoreSend(); restoreProvider2();

  let tasks = await memory.listTasks();
  let task1 = tasks.find((t) => t.instruction === 'Reply on Telegram to chat-disabled');
  assert.strictEqual(task1.status, 'pending_approval', 'with auto-reply disabled, the task must stay pending regardless of anything else');
  assert.strictEqual(sendCalled, false);
  console.log('✓ TelegramAgent: with auto-reply disabled (default), even a well-grounded message stays pending for manual approval');

  // Case 9: auto-reply ENABLED + business info configured + a genuinely grounded reply - actually auto-sends.
  config.autoReply.telegram.enabled = true;
  sendCalled = false;
  let sentPayload = null;
  restoreSend = stubTool('telegram.sendMessage', async (args) => { sendCalled = true; sentPayload = args; return { status: 'sent' }; });
  let call = 0;
  const responses = ['We are open Mon-Fri 8am-6pm!', 'GROUNDED'];
  const origMock = mockProvider.complete;
  const origAi = aiProvider.complete;
  const respond = async () => ({ text: responses[Math.min(call++, responses.length - 1)], provider: 'mock', costEstimate: 0 });
  mockProvider.complete = respond;
  aiProvider.complete = respond;

  await agent.handleIncomingMessage({ from: 'chat-enabled-grounded', body: 'What are your hours?' });

  mockProvider.complete = origMock;
  aiProvider.complete = origAi;
  restoreSend();
  config.autoReply.telegram.enabled = false;

  assert.strictEqual(sendCalled, true, 'a genuinely grounded reply with auto-reply enabled should actually send through the real approval path');
  assert.strictEqual(sentPayload.to, 'chat-enabled-grounded');
  tasks = await memory.listTasks();
  const task2 = tasks.find((t) => t.instruction === 'Reply on Telegram to chat-enabled-grounded');
  assert.strictEqual(task2.status, 'done');
  console.log('✓ TelegramAgent: with auto-reply enabled and business info configured, a grounded reply auto-sends through the real approval-execution path');

  // Case 10: auto-reply ENABLED but the message is a risk-category topic - stays pending despite the flag being on.
  config.autoReply.telegram.enabled = true;
  sendCalled = false;
  restoreSend = stubTool('telegram.sendMessage', async () => { sendCalled = true; return { status: 'sent' }; });
  restoreProvider2 = stubProvider('I understand, let me see what we can do about your refund.');
  await agent.handleIncomingMessage({ from: 'chat-risky', body: 'I want a refund, this is unacceptable' });
  restoreSend(); restoreProvider2();
  config.autoReply.telegram.enabled = false;

  assert.strictEqual(sendCalled, false, 'a risk-category message must stay pending even with auto-reply enabled');
  tasks = await memory.listTasks();
  const task3 = tasks.find((t) => t.instruction === 'Reply on Telegram to chat-risky');
  assert.strictEqual(task3.status, 'pending_approval');
  console.log('✓ TelegramAgent: with auto-reply enabled, a risk-category message still stays pending for a human');

  Object.keys(config.business).forEach((k) => delete config.business[k]);
  Object.assign(config.business, originalBusiness);

  console.log('\nAll auto-reply safety checks passed.');
}

main().catch((err) => {
  console.error('✗ auto-reply-safety.test.js failed:', err);
  process.exit(1);
});