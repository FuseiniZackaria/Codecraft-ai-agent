const config = require('../../config');
const ctx = require('./context');

/**
 * Per-admin API usage and monthly spending caps (migration 0013).
 *
 *   check()  before every real AI call: blocks when the person (or the
 *            "automated" bucket) has reached this month's cap.
 *   record() after every real AI call: one api_usage row with tokens and the
 *            ESTIMATED cost (config/aiPrices.js).
 *
 * Kept cheap: each bucket's month-to-date spend is read from the database
 * once (an SQL sum), then kept in memory and topped up after every call;
 * caps are cached for a minute. LIMITATION (accepted): requests running at
 * the same moment all pass the check before any of them records, so a cap
 * can be overshot by those few calls. No locking beyond that.
 *
 * A failure to read or write usage never breaks the user's request: the
 * call goes ahead (fail open for availability) and a warning is logged.
 */

const AUTOMATED_CAP_KEY = '00000000-0000-0000-0000-000000000000'; // usage_caps row for the "automated" bucket
const CAP_TTL_MS = 60 * 1000;
const SPEND_TTL_MS = 5 * 60 * 1000;
const WARN_AT = 0.8;

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}

const mem = { rows: [], caps: new Map() }; // tests / no database
const capCache = new Map(); // capKey -> { cap, at }
const spendCache = new Map(); // capKey -> { month, usd, at }
const testing = { failWrites: false };
let warnedMissing = false;

function missing(error) {
  return /does not exist|schema cache|function .* does not exist/i.test(error?.message || '');
}
function warnMissingOnce() {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn('[usage] the usage tables are missing - run backend/database/migrations/0013_owner_and_usage.sql (usage is not tracked until then)');
}

/** Start of the current calendar month, UTC. */
function monthStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

const capKeyOf = (userId) => userId || AUTOMATED_CAP_KEY;

// ---------- caps ----------

async function getCap(userId) {
  const key = capKeyOf(userId);
  const hit = capCache.get(key);
  if (hit && Date.now() - hit.at < CAP_TTL_MS) return hit.cap;
  let cap = null;
  if (!db()) cap = mem.caps.has(key) ? mem.caps.get(key).monthly_cap_usd : null;
  else {
    const { data, error } = await db().from('usage_caps').select('monthly_cap_usd').eq('user_id', key).maybeSingle();
    if (error) { if (missing(error)) warnMissingOnce(); else throw error; }
    cap = data?.monthly_cap_usd ?? null;
  }
  cap = cap === null || cap === undefined ? null : Number(cap);
  capCache.set(key, { cap, at: Date.now() });
  return cap;
}

/** Set or clear (null) a cap. userId null = the "automated" bucket. */
async function setCap(userId, capUsd, updatedBy) {
  const key = capKeyOf(userId);
  const row = { user_id: key, monthly_cap_usd: capUsd, updated_by: updatedBy || null, updated_at: new Date().toISOString() };
  if (!db()) mem.caps.set(key, row);
  else {
    const { error } = await db().from('usage_caps').upsert(row, { onConflict: 'user_id' });
    if (error) throw new Error(missing(error) ? 'The usage tables are missing - run migration 0013 first.' : error.message);
  }
  capCache.delete(key);
  return row;
}

async function listCaps() {
  if (!db()) return [...mem.caps.values()];
  const { data, error } = await db().from('usage_caps').select('*');
  if (error) { if (missing(error)) { warnMissingOnce(); return []; } throw error; }
  return data || [];
}

// ---------- spend ----------

/** This month's spend for one bucket (SQL sum once, then kept up to date in memory). */
async function monthSpend(userId) {
  const key = capKeyOf(userId);
  const month = monthStart();
  const hit = spendCache.get(key);
  if (hit && hit.month === month && Date.now() - hit.at < SPEND_TTL_MS) return hit.usd;
  let usd = 0;
  if (!db()) {
    usd = mem.rows.filter((r) => (r.user_id || null) === (userId || null) && r.created_at >= month).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
  } else {
    const { data, error } = await db().rpc('api_usage_month_total', { p_user: userId || null, p_from: month });
    if (error) { if (missing(error)) warnMissingOnce(); else throw error; }
    usd = Number(data || 0);
  }
  spendCache.set(key, { month, usd, at: Date.now() });
  return usd;
}

class CapReachedError extends Error {
  constructor(spent, cap) {
    super('Monthly API credit cap reached. Ask the owner to raise it.');
    this.name = 'CapReachedError';
    this.code = 'USAGE_CAP_REACHED';
    this.spent = spent;
    this.cap = cap;
  }
}

/**
 * Before a real AI call. Throws CapReachedError at or over the cap; returns
 * { spent, cap, warning } otherwise. Reading problems never block the call.
 */
async function check() {
  const c = ctx.current();
  try {
    const cap = await getCap(c.userId);
    if (cap === null) return { spent: null, cap: null, warning: false };
    const spent = await monthSpend(c.userId);
    if (spent >= cap) throw new CapReachedError(spent, cap);
    return { spent, cap, warning: spent >= cap * WARN_AT };
  } catch (err) {
    if (err instanceof CapReachedError) throw err;
    console.warn(`[usage] cap check skipped: ${err.message}`);
    return { spent: null, cap: null, warning: false };
  }
}

/** After a real AI call: one row. Never throws. */
async function record({ provider, model, inputTokens = 0, outputTokens = 0, costUsd = 0, agent = null }) {
  const c = ctx.current();
  const row = {
    user_id: c.userId || null,
    user_email: c.email || null,
    agent: c.agent || agent || null,
    task_id: c.taskId || null,
    provider: provider || null,
    model: model || null,
    input_tokens: Math.max(0, Math.round(Number(inputTokens) || 0)),
    output_tokens: Math.max(0, Math.round(Number(outputTokens) || 0)),
    cost_usd: Math.max(0, Number(costUsd) || 0),
    created_at: new Date().toISOString(),
  };
  // Keep the running total right even if the write fails.
  const key = capKeyOf(row.user_id);
  const hit = spendCache.get(key);
  if (hit && hit.month === monthStart()) hit.usd += row.cost_usd;
  try {
    if (testing.failWrites) throw new Error('simulated write failure');
    if (!db()) mem.rows.push(row);
    else {
      const { error } = await db().from('api_usage').insert(row);
      if (error) { if (missing(error)) { warnMissingOnce(); return false; } throw error; }
    }
    return true;
  } catch (err) {
    console.warn(`[usage] not recorded (${err.message}) - the request continues`);
    return false;
  }
}

// ---------- reports (SQL group by - never every row) ----------

/** Rows grouped by person, agent and month since `fromIso`: [{ user_id, user_email, agent, month, cost_usd, input_tokens, output_tokens, calls }] */
async function summary(fromIso) {
  if (!db()) {
    const groups = new Map();
    for (const r of mem.rows.filter((x) => x.created_at >= fromIso)) {
      const month = r.created_at.slice(0, 7);
      const k = `${r.user_id || ''}|${r.agent || ''}|${month}`;
      const g = groups.get(k) || { user_id: r.user_id || null, user_email: r.user_email || null, agent: r.agent || null, month, cost_usd: 0, input_tokens: 0, output_tokens: 0, calls: 0 };
      g.cost_usd += Number(r.cost_usd); g.input_tokens += r.input_tokens; g.output_tokens += r.output_tokens; g.calls += 1;
      groups.set(k, g);
    }
    return [...groups.values()];
  }
  const { data, error } = await db().rpc('api_usage_summary', { p_from: fromIso });
  if (error) { if (missing(error)) { warnMissingOnce(); return []; } throw error; }
  return (data || []).map((r) => ({ ...r, cost_usd: Number(r.cost_usd || 0), input_tokens: Number(r.input_tokens || 0), output_tokens: Number(r.output_tokens || 0), calls: Number(r.calls || 0) }));
}

function _reset() {
  mem.rows.length = 0;
  mem.caps.clear();
  capCache.clear();
  spendCache.clear();
  testing.failWrites = false;
}

module.exports = {
  check, record, getCap, setCap, listCaps, monthSpend, summary, monthStart, CapReachedError,
  AUTOMATED_CAP_KEY, WARN_AT, testing, _reset, _mem: mem,
};
