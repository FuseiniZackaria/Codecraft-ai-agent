const { FinishReason, ThinkingLevel } = require('@google/genai');
const config = require('../../config');
const memory = require('../../memory');
const { buildFrozenSystemPrompt, buildPerRequestContextBlock } = require('./systemPrompt');
const { buildTools } = require('./tools');
const { invoke } = require('./handlers');
const usage = require('./usage');
const gemini = require('../providers/gemini');
const { startTimer } = require('../debugTiming');

// Greetings and thanks need no tools - sending the 16 tool definitions for
// "hi" only adds tokens and latency. Anything with more words than a greeting
// (e.g. "ok do it", "hi, find me leads") keeps the tools.
function isSmallTalk(message) {
  const name = String(config.assistant.name || 'Ian').replace(/[^\w ]/g, '');
  const pattern = new RegExp(
    '^(hi+|hey+|hello+|hiya|howdy|good (morning|afternoon|evening)|thanks|thank you|thx|ty|bye|goodbye)' +
      `(,?\\s+(there|${name}|again|all|everyone|so much|a lot))?[\\s!.?,]*$`,
    'i'
  );
  return message.length <= 40 && pattern.test(message.trim());
}

// Finish reasons where Gemini declined to answer - surfaced as a 'refusal' event.
const REFUSAL_REASONS = new Set([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

/**
 * Load the N most recent chat_messages rows and shape them for the API.
 * `chat_messages` stores rows oldest-first after SupabaseStore.listChatMessages
 * reverses them, so just take the tail. Gemini calls the assistant 'model'.
 */
async function loadRecentHistory(limit, { workspaceId = null } = {}) {
  const rows = await memory.listChatMessages(limit, { workspaceId });
  return rows
    .filter((m) => m.content && m.content.trim().length > 0)
    .slice(-limit)
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
}

/**
 * Build the system instruction. Frozen prompt first, per-request context
 * (date, business profile) after it, so the unchanging prefix stays eligible
 * for Gemini's implicit prompt caching.
 */
async function buildSystemInstruction({ voice, workspaceId = null }) {
  return {
    parts: [
      { text: buildFrozenSystemPrompt() },
      { text: await buildPerRequestContextBlock({ voice, workspaceId }) },
    ],
  };
}

/** Tool definitions are written in Anthropic's shape ({name, description, input_schema}); Gemini takes the same JSON Schema. */
function toFunctionDeclarations(tools) {
  return tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema }));
}

/**
 * Main entry point.
 *
 * @param {object} opts
 * @param {string} opts.message - the user's new message this turn
 * @param {string|null} opts.scope - department key, or null for global
 * @param {function} opts.onEvent - called with {type, ...} for each stream event
 * @returns {Promise<{reply: string, taskIds: string[], usage: object, iterations: number}>}
 */
async function runAssistant({ message, scope = null, voice = false, workspaceId = null, onEvent = () => {}, timer = startTimer('ian') }) {
  if (!config.assistant.apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  // Cap check, history and system prompt are independent Supabase reads - run them together.
  const [overCap, history, systemInstruction] = await Promise.all([
    usage.isOverCap(memory, workspaceId),
    loadRecentHistory(config.assistant.historyLimit, { workspaceId }),
    buildSystemInstruction({ voice, workspaceId }),
  ]);
  timer.mark('loaded cap + history + system prompt', { historyRows: history.length });
  if (overCap) {
    const daily = await usage.getDaily(memory, workspaceId);
    const err = new Error(`daily_cap_reached: ${daily.usd.toFixed(2)} today`);
    err.code = 'DAILY_CAP_REACHED';
    throw err;
  }

  const smallTalk = isSmallTalk(message);
  const tools = smallTalk ? [] : buildTools(scope);
  const functionDeclarations = toFunctionDeclarations(tools);
  timer.mark('built tools', { tools: tools.length, smallTalk });

  const contents = [...history, { role: 'user', parts: [{ text: message }] }];

  const collectedTaskIds = [];
  const context = { history, collectedTaskIds, workspaceId, userMessage: message };
  const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const usageByModel = new Map(); // model -> usage, so each model is priced at its own rate

  let fullReply = '';
  let iterations = 0;
  const MAX_ITERATIONS = 6;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const { model, chunks, attempts } = await gemini.startStream({
      model: config.assistant.model,
      contents,
      config: {
        systemInstruction,
        ...(functionDeclarations.length ? { tools: [{ functionDeclarations }] } : {}),
        maxOutputTokens: config.assistant.maxTokens,
        // LOW is the lowest level gemini-3.8-flash accepts (MINIMAL is rejected);
        // thinking tokens count against maxOutputTokens.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    timer.mark(`model call ${iterations}: first chunk`, { provider: 'gemini', model, tools: tools.length, thinking: 'LOW', attempts });

    // Keep every part exactly as streamed (including thoughtSignature) - Gemini
    // needs them echoed back unchanged on the next turn of a function-calling loop.
    const modelParts = [];
    let currentTextBlock = '';
    let finishReason = null;
    let blocked = false;
    let lastUsage = null;
    for await (const chunk of chunks) {
      if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;
      if (chunk.promptFeedback?.blockReason) blocked = true;
      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;
      if (candidate.finishReason) finishReason = candidate.finishReason;
      for (const part of candidate.content?.parts || []) {
        modelParts.push(part);
        if (part.thought) continue;
        if (part.text) {
          currentTextBlock += part.text;
          onEvent({ type: 'text_delta', text: part.text });
        } else if (part.functionCall) {
          onEvent({ type: 'tool_start', name: part.functionCall.name });
        }
      }
    }

    accumulateUsage(totalUsage, lastUsage);
    if (!usageByModel.has(model)) usageByModel.set(model, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    accumulateUsage(usageByModel.get(model), lastUsage);
    timer.mark(`model call ${iterations}: stream done`, { model, finishReason, chars: currentTextBlock.length });

    if (modelParts.length) contents.push({ role: 'model', parts: modelParts });

    const calls = modelParts.filter((p) => p.functionCall).map((p) => p.functionCall);
    if (calls.length) {
      const responseParts = [];
      for (const call of calls) {
        const result = await invoke(call.name, call.args || {}, context);
        timer.mark(`tool ${call.name}`, { ok: result?.ok !== false });
        onEvent({ type: 'tool_end', name: call.name, result });
        const response = result && typeof result === 'object' && !Array.isArray(result) ? result : { output: result };
        responseParts.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response } });
      }
      contents.push({ role: 'user', parts: responseParts });
      continue;
    }

    // STOP / MAX_TOKENS / safety block - we're done
    fullReply = currentTextBlock;

    if (blocked || REFUSAL_REASONS.has(finishReason)) {
      onEvent({ type: 'refusal' });
    }
    break;
  }

  for (const [model, u] of usageByModel) await usage.record(memory, model, u, workspaceId);

  return {
    reply: fullReply || "I didn't get a response - try again?",
    taskIds: collectedTaskIds,
    usage: totalUsage,
    iterations,
  };
}

/** Map Gemini's usageMetadata onto the token buckets usage.js and the frontend already use. */
function accumulateUsage(total, u) {
  if (!u) return;
  const cached = u.cachedContentTokenCount || 0;
  total.input_tokens += Math.max(0, (u.promptTokenCount || 0) - cached);
  total.output_tokens += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  total.cache_read_input_tokens += cached;
}

module.exports = { runAssistant };
