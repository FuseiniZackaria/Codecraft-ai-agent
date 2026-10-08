const Anthropic = require('@anthropic-ai/sdk');
const config = require('../../config');
const memory = require('../../memory');
const { buildFrozenSystemPrompt, buildPerRequestContextBlock } = require('./systemPrompt');
const { buildTools } = require('./tools');
const { invoke } = require('./handlers');
const usage = require('./usage');

let client = null;
function getClient() {
  if (!config.assistant.apiKey) {
    throw new Error('ANTHROPIC_API_KEY (or AI_API_KEY) is not set');
  }
  if (!client) {
    client = new Anthropic({ apiKey: config.assistant.apiKey, maxRetries: 3 });
  }
  return client;
}

/**
 * Load the N most recent chat_messages rows and shape them for the API.
 * `chat_messages` stores rows oldest-first after SupabaseStore.listChatMessages
 * reverses them, so just take the tail.
 */
async function loadRecentHistory(limit) {
  const rows = await memory.listChatMessages(limit);
  return rows
    .filter((m) => m.content && m.content.trim().length > 0)
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Build the system blocks array. Frozen prompt + tools are cached via
 * cache_control: ephemeral. Per-request context (date, business profile)
 * goes AFTER the breakpoint so it never invalidates the cache.
 */
function buildSystemBlocks({ voice }) {
  return [
    {
      type: 'text',
      text: buildFrozenSystemPrompt(),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: buildPerRequestContextBlock({ voice }),
    },
  ];
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
async function runAssistant({ message, scope = null, voice = false, onEvent = () => {} }) {
  if (await usage.isOverCap(memory)) {
    const daily = await usage.getDaily(memory);
    const err = new Error(`daily_cap_reached: $${daily.usd.toFixed(2)} today`);
    err.code = 'DAILY_CAP_REACHED';
    throw err;
  }

  const anthropic = getClient();
  const history = await loadRecentHistory(config.assistant.historyLimit);
  const tools = buildTools(scope);
  const system = buildSystemBlocks({ voice });

  const messages = [...history, { role: 'user', content: message }];

  const collectedTaskIds = [];
  const context = { history, collectedTaskIds };
  const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  let fullReply = '';
  let iterations = 0;
  const MAX_ITERATIONS = 6;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const stream = anthropic.messages.stream({
      model: config.assistant.model,
      max_tokens: config.assistant.maxTokens,
      system,
      tools,
      messages,
    });

    let currentTextBlock = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          currentTextBlock += event.delta.text;
          onEvent({ type: 'text_delta', text: event.delta.text });
        }
      } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        onEvent({ type: 'tool_start', name: event.content_block.name });
      }
    }

    const final = await stream.finalMessage();
    accumulateUsage(totalUsage, final.usage);

    messages.push({ role: 'assistant', content: final.content });

    if (final.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of final.content) {
        if (block.type !== 'tool_use') continue;
        const result = await invoke(block.name, block.input, context);
        onEvent({ type: 'tool_end', name: block.name, result });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: result?.ok === false,
        });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // end_turn / max_tokens / stop_sequence / refusal - we're done
    if (currentTextBlock) fullReply = currentTextBlock;
    else {
      // extract text from the final message directly
      const textBlocks = final.content.filter((b) => b.type === 'text').map((b) => b.text);
      fullReply = textBlocks.join('\n');
    }

    if (final.stop_reason === 'refusal') {
      onEvent({ type: 'refusal' });
    }
    break;
  }

  await usage.record(memory, config.assistant.model, totalUsage);

  return {
    reply: fullReply || "I didn't get a response - try again?",
    taskIds: collectedTaskIds,
    usage: totalUsage,
    iterations,
  };
}

function accumulateUsage(total, u) {
  if (!u) return;
  total.input_tokens += u.input_tokens || 0;
  total.output_tokens += u.output_tokens || 0;
  total.cache_read_input_tokens += u.cache_read_input_tokens || 0;
  total.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
}

module.exports = { runAssistant };
