const config = require('../../config');

/**
 * Shared Gemini access for Ian (core/assistant) and the agents (aiProvider).
 *
 * Fail fast instead of hanging: the free tier often answers 429 (rate limit)
 * or 503 (overloaded), and a busy model can sit on a request for minutes
 * before the first token. So the SDK's own retries are off, every attempt
 * gets a first-chunk deadline, and on a 429/5xx/deadline we switch once to
 * the fallback model instead of retrying the same overloaded one. A model
 * that just failed is then skipped for a cooldown, so the next calls don't
 * each wait out the same deadline again.
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const cooldownUntil = new Map(); // model -> timestamp it may be tried again

let client = null;
function getClient() {
  if (!client) {
    // Required here rather than at the top so tests can swap the SDK module first.
    const { GoogleGenAI } = require('@google/genai');
    client = new GoogleGenAI({ apiKey: config.llm.geminiKey, httpOptions: { retryOptions: { attempts: 1 } } });
  }
  return client;
}

/** Primary model first, then the fallback (if different); models cooling down move to the end as a last resort. */
function modelChain(primary) {
  const chain = [...new Set([primary, config.llm.fallbackModel].filter(Boolean))];
  const now = Date.now();
  const cooling = (m) => cooldownUntil.get(m) > now;
  return [...chain.filter((m) => !cooling(m)), ...chain.filter(cooling)];
}

function statusOf(err) {
  if (err.timedOut) return 'timeout';
  if (typeof err.status === 'number') return err.status;
  const m = /"code":\s*(\d{3})/.exec(String(err.message));
  return m ? Number(m[1]) : null;
}

function isRetryable(err) {
  const status = statusOf(err);
  return status === 'timeout' || RETRYABLE_STATUS.has(status);
}

/** Short, user-facing reason for a failed Gemini call. */
function describeFailure(err) {
  const status = statusOf(err);
  if (status === 429) return 'Gemini rate limit reached (free tier) - try again in a minute';
  if (status === 503) return 'Gemini is overloaded right now - try again shortly';
  if (status === 'timeout') return 'Gemini took too long to respond - try again shortly';
  return err.message;
}

/**
 * Start a streaming generateContent call, falling back to the next model on a
 * retryable failure before the first chunk arrives. Once a chunk is in hand
 * the stream is committed to that model (text may already be on screen).
 *
 * @returns {Promise<{model: string, chunks: AsyncGenerator, attempts: Array}>}
 *   attempts: [{model, ms, status}] for every model tried, for timing logs.
 */
async function startStream({ model, contents, config: genConfig }) {
  const attempts = [];
  let lastErr = null;
  const chain = modelChain(model);
  for (const [index, candidate] of chain.entries()) {
    const controller = new AbortController();
    const started = Date.now();
    let timedOut = false;
    // The last model has nothing to switch to, so it gets longer before giving up.
    const deadline = index === chain.length - 1 ? config.llm.lastAttemptTimeoutMs : config.llm.firstChunkTimeoutMs;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, deadline);
    try {
      const stream = await getClient().models.generateContentStream({
        model: candidate,
        contents,
        config: { ...genConfig, abortSignal: controller.signal },
      });
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      clearTimeout(timer);
      attempts.push({ model: candidate, ms: Date.now() - started, status: 'ok' });
      const chunks = (async function* () {
        if (!first.done) yield first.value;
        yield* { [Symbol.asyncIterator]: () => iterator };
      })();
      return { model: candidate, chunks, attempts };
    } catch (err) {
      clearTimeout(timer);
      if (timedOut) err.timedOut = true;
      const status = statusOf(err);
      attempts.push({ model: candidate, ms: Date.now() - started, status });
      lastErr = err;
      if (status === 429) console.warn(`[gemini] 429 rate-limited on ${candidate} (free-tier quota)`);
      if (!isRetryable(err)) break;
      if (index < chain.length - 1) cooldownUntil.set(candidate, Date.now() + config.llm.cooldownMs);
      if (index === chain.length - 1) break;
      console.warn(`[gemini] ${candidate} failed (${status}) after ${Date.now() - started}ms - trying ${chain[index + 1]}; ${candidate} goes last for ${Math.round(config.llm.cooldownMs / 1000)}s`);
    }
  }
  const err = new Error(describeFailure(lastErr));
  err.status = statusOf(lastErr);
  err.code = 'GEMINI_UNAVAILABLE';
  err.attempts = attempts;
  throw err;
}

/** Test hook: forget every cooldown. */
function resetCooldowns() {
  cooldownUntil.clear();
}

module.exports = { startStream, modelChain, describeFailure, resetCooldowns };
