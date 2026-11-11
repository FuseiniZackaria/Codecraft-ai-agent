/**
 * Can OpenAI be used right now? Only cover images (and the old speech.transcribe
 * tool) use OpenAI; all text runs on Anthropic or Gemini (AI_PROVIDER).
 *
 * Not usable when OPENAI_API_KEY is missing, isn't an OpenAI key at all (they
 * start with "sk-"; e.g. a Google key pasted there), or OpenAI already
 * rejected it / said there's no credit - remembered until the server restarts,
 * so a bad key is tried once, not on every task.
 */

let rejected = null; // reason OpenAI gave, once it refused the key

function status() {
  const key = require('../config').llm.openaiKey; // read fresh (tests reload the settings)
  if (!key) return { usable: false, reason: 'no OpenAI key is set (OPENAI_API_KEY)' };
  if (!/^sk-/.test(String(key).trim())) return { usable: false, reason: "OPENAI_API_KEY doesn't look like an OpenAI key (they start with \"sk-\")" };
  if (rejected) return { usable: false, reason: rejected };
  return { usable: true, reason: null };
}

/** After an OpenAI error: if it means "this key won't work", remember it. Returns true when it did. */
function noteFailure(httpStatus, json) {
  const code = json?.error?.code || json?.error?.type || '';
  const message = String(json?.error?.message || '');
  if (httpStatus === 401 || /invalid_api_key|incorrect api key/i.test(`${code} ${message}`)) {
    rejected = 'OpenAI rejected the API key (OPENAI_API_KEY)';
    return true;
  }
  if (/insufficient_quota|billing|exceeded your current quota/i.test(`${code} ${message}`)) {
    rejected = 'the OpenAI account has no credit left';
    return true;
  }
  return false;
}

class OpenAIUnavailableError extends Error {
  constructor(reason) {
    super(`OpenAI isn't available: ${reason}`);
    this.name = 'OpenAIUnavailableError';
    this.code = 'OPENAI_UNAVAILABLE';
  }
}

function _reset() { rejected = null; }

module.exports = { status, noteFailure, OpenAIUnavailableError, _reset };
