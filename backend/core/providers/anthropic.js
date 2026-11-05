const config = require('../../config');

/**
 * Shared Claude (Anthropic) access for Ian (core/assistant) and the agents
 * (aiProvider). Used when config.llm.provider is 'anthropic'.
 *
 * - The SDK retries 429/5xx/connection errors itself (maxRetries below).
 * - Server-side refusal fallback is on ("default"): if Claude's safety checks
 *   decline a request, the API re-runs it on a suitable fallback model in the
 *   same call instead of returning nothing.
 * - Effort (config.anthropic.effort, default 'low') keeps replies quick and cheap.
 */

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client = null;
function getClient() {
  if (!config.llm.anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!client) {
    // Required here rather than at the top so tests can swap the SDK module first.
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: config.llm.anthropicKey, maxRetries: 2, timeout: 120000 });
  }
  return client;
}

/** Start a streaming request. Returns the SDK's MessageStream (iterate it, then await .finalMessage()). */
function stream({ system, messages, tools = [], maxTokens = 16000 }) {
  return getClient().beta.messages.stream({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: config.anthropic.effort },
    ...(system ? { system } : {}),
    ...(tools.length ? { tools } : {}),
    messages,
  });
}

/** Short, user-facing reason for a failed Claude call. */
function describeFailure(err) {
  const status = err?.status;
  if (status === 401) return 'Anthropic rejected the API key - check ANTHROPIC_API_KEY';
  if (status === 402 || /credit balance/i.test(err?.message || '')) return 'Anthropic account is out of credit - top up at console.anthropic.com';
  if (status === 429) return 'Anthropic rate limit reached - try again in a minute';
  if (status === 529 || status === 503) return 'Claude is overloaded right now - try again shortly';
  return err?.message || 'unknown error';
}

/** Test hook: drop the cached client so a swapped SDK/key takes effect. */
function resetClient() {
  client = null;
}

module.exports = { stream, describeFailure, resetClient, getClient };
