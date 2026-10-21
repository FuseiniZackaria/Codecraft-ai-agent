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
 * Daily usage counter, one per workspace. Resets at local-midnight on first
 * access after rollover. In-memory primary - lazy-persist to Supabase so a
 * restart doesn't wipe the running total if we're mid-day. A caller with no
 * workspace (legacy single-tenant) shares one "legacy" counter.
 */
const states = new Map(); // workspaceKey -> { day, usd, inputTokens, outputTokens, dirty, hydrated }
const persistTimers = new Map(); // workspaceKey -> timer

const keyOf = (workspaceId) => workspaceId || 'legacy';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function blank(day) {
  return { day, usd: 0, inputTokens: 0, outputTokens: 0, dirty: false, hydrated: false };
}

function stateFor(workspaceId) {
  const key = keyOf(workspaceId);
  let state = states.get(key);
  const today = todayKey();
  if (!state || state.day !== today) {
    state = blank(today);
    states.set(key, state);
  }
  return state;
}

async function hydrate(memory, workspaceId) {
  const state = stateFor(workspaceId);
  if (state.hydrated) return state;
  state.hydrated = true;
  try {
    const row = await memory.getAssistantUsage?.(state.day, { workspaceId: workspaceId || null });
    if (row) {
      state.usd = row.usd || 0;
      state.inputTokens = row.input_tokens || 0;
      state.outputTokens = row.output_tokens || 0;
    }
  } catch {
    // table may not exist yet (new install) - stay at zero
  }
  return state;
}

function schedulePersist(memory, workspaceId) {
  const key = keyOf(workspaceId);
  if (persistTimers.has(key)) return;
  persistTimers.set(key, setTimeout(async () => {
    persistTimers.delete(key);
    const state = states.get(key);
    if (!state || !state.dirty) return;
    const snapshot = { ...state };
    state.dirty = false;
    try {
      await memory.upsertAssistantUsage?.(snapshot.day, {
        usd: snapshot.usd,
        input_tokens: snapshot.inputTokens,
        output_tokens: snapshot.outputTokens,
        workspace_id: workspaceId || null,
      }, { workspaceId: workspaceId || null });
    } catch (err) {
      console.warn(`[assistant.usage] persist failed: ${err.message}`);
      state.dirty = true;
    }
  }, 2000));
}

async function record(memory, model, usage, workspaceId = null) {
  const state = await hydrate(memory, workspaceId);
  const usd = costOf(model, usage);
  state.usd += usd;
  state.inputTokens += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  state.outputTokens += usage.output_tokens || 0;
  state.dirty = true;
  schedulePersist(memory, workspaceId);
  console.log(
    `[assistant.usage] +$${usd.toFixed(4)} (in=${usage.input_tokens || 0} out=${usage.output_tokens || 0} cache_read=${usage.cache_read_input_tokens || 0}) daily=$${state.usd.toFixed(4)}`
  );
  return { usd, dailyUsd: state.usd };
}

async function isOverCap(memory, workspaceId = null) {
  const state = await hydrate(memory, workspaceId);
  const cap = config.assistant.dailyUsdCap;
  if (!cap || cap <= 0) return false;
  return state.usd >= cap;
}

async function getDaily(memory, workspaceId = null) {
  const state = await hydrate(memory, workspaceId);
  return { day: state.day, usd: state.usd, inputTokens: state.inputTokens, outputTokens: state.outputTokens };
}

/** Test hook: write any pending counters now instead of waiting for the debounce timer. */
async function flush(memory) {
  for (const [key, timer] of persistTimers) {
    clearTimeout(timer);
    persistTimers.delete(key);
    const state = states.get(key);
    if (!state?.dirty) continue;
    const workspaceId = key === 'legacy' ? null : key;
    state.dirty = false;
    await memory.upsertAssistantUsage?.(state.day, {
      usd: state.usd,
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      workspace_id: workspaceId,
    }, { workspaceId });
  }
}

module.exports = { record, isOverCap, getDaily, costOf, flush };
