const config = require('../../config');

/**
 * Per-million-token USD prices. Keep this table narrow - only the models the
 * Assistant actually calls. Prompt-cache reads are ~10% of normal input;
 * cache writes are ~1.25x. Verify in the current Anthropic pricing page if
 * you add a model here.
 */
const PRICING = {
  'claude-sonnet-5-5':   { input: 2.0,  output: 10.0 },
  'claude-opus-5-5':     { input: 4.0,  output: 20.0 },
  'claude-haiku-4-5':    { input: 1.0,  output: 5.0  },
  'claude-sonnet-5':     { input: 2.0,  output: 10.0 }, // kept for compat
};

function costOf(model, usage) {
  const price = PRICING[model];
  if (!price) return 0;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  return (
    (input / 1_000_000) * price.input +
    (output / 1_000_000) * price.output +
    (cacheRead / 1_000_000) * price.input * 0.1 +
    (cacheCreate / 1_000_000) * price.input * 1.25
  );
}

/**
 * Daily usage counter. Resets at local-midnight on first access after rollover.
 * In-memory primary - lazy-persist to Supabase so a restart doesn't wipe the
 * running total if we're mid-day.
 */
let state = { day: null, usd: 0, inputTokens: 0, outputTokens: 0, dirty: false };
let persistTimer = null;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function hydrate(memory) {
  if (state.day) return;
  state.day = todayKey();
  try {
    const row = await memory.getAssistantUsage?.(state.day);
    if (row) {
      state.usd = row.usd || 0;
      state.inputTokens = row.input_tokens || 0;
      state.outputTokens = row.output_tokens || 0;
    }
  } catch {
    // table may not exist yet (new install) - stay at zero
  }
}

function rollIfNeeded() {
  const today = todayKey();
  if (state.day !== today) {
    state = { day: today, usd: 0, inputTokens: 0, outputTokens: 0, dirty: false };
  }
}

function schedulePersist(memory) {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    if (!state.dirty) return;
    const snapshot = { ...state };
    state.dirty = false;
    try {
      await memory.upsertAssistantUsage?.(snapshot.day, {
        usd: snapshot.usd,
        input_tokens: snapshot.inputTokens,
        output_tokens: snapshot.outputTokens,
      });
    } catch (err) {
      console.warn(`[assistant.usage] persist failed: ${err.message}`);
      state.dirty = true;
    }
  }, 2000);
}

async function record(memory, model, usage) {
  await hydrate(memory);
  rollIfNeeded();
  const usd = costOf(model, usage);
  state.usd += usd;
  state.inputTokens += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  state.outputTokens += usage.output_tokens || 0;
  state.dirty = true;
  schedulePersist(memory);
  console.log(
    `[assistant.usage] +$${usd.toFixed(4)} (in=${usage.input_tokens || 0} out=${usage.output_tokens || 0} cache_read=${usage.cache_read_input_tokens || 0}) daily=$${state.usd.toFixed(4)}`
  );
  return { usd, dailyUsd: state.usd };
}

async function isOverCap(memory) {
  await hydrate(memory);
  rollIfNeeded();
  const cap = config.assistant.dailyUsdCap;
  if (!cap || cap <= 0) return false;
  return state.usd >= cap;
}

async function getDaily(memory) {
  await hydrate(memory);
  rollIfNeeded();
  return { day: state.day, usd: state.usd, inputTokens: state.inputTokens, outputTokens: state.outputTokens };
}

module.exports = { record, isOverCap, getDaily, costOf };
