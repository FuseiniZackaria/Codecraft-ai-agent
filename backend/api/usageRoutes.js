const express = require('express');
const config = require('../config');
const meter = require('../core/usage/meter');
const { teamMutationLimiter } = require('../core/rateLimits');

/**
 * /api/usage - ESTIMATED API spend (config/aiPrices.js).
 *   GET  /me             any admin: only their own numbers
 *   GET  /               owner: everyone + the "automated" bucket + totals
 *   PUT  /caps/:userId   owner: set or clear a monthly cap (userId or "automated")
 * Totals come from SQL group-by (api_usage_summary), never every row.
 * Fetched on demand (page open / Refresh) - nothing polls this.
 */
const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round = (n) => Math.round(Number(n || 0) * 10000) / 10000;
const ownerOnly = (req, res, next) => (req.user?.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can see this.' }));

function sixMonthsAgo() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 5, 1)).toISOString();
}
function lastSixMonths() {
  const d = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (5 - i), 1));
    return m.toISOString().slice(0, 7);
  });
}

/** One person's (or the automated bucket's) numbers from the grouped rows. */
function describe(rows, { userId, cap }) {
  const thisMonth = meter.monthStart().slice(0, 7);
  const mine = rows.filter((r) => (r.user_id || null) === (userId || null));
  const now = mine.filter((r) => r.month === thisMonth);
  const spent = now.reduce((s, r) => s + r.cost_usd, 0);
  const byAgent = {};
  for (const r of now) {
    const a = r.agent || 'other';
    byAgent[a] = byAgent[a] || { agent: a, costUsd: 0, calls: 0 };
    byAgent[a].costUsd += r.cost_usd;
    byAgent[a].calls += r.calls;
  }
  const months = lastSixMonths().map((m) => ({ month: m, costUsd: round(mine.filter((r) => r.month === m).reduce((s, r) => s + r.cost_usd, 0)) }));
  return {
    spentUsd: round(spent),
    capUsd: cap,
    remainingUsd: cap === null ? null : round(Math.max(0, cap - spent)),
    percent: cap ? Math.min(999, Math.round((spent / cap) * 100)) : null,
    warning: cap !== null && spent >= cap * meter.WARN_AT && spent < cap,
    blocked: cap !== null && spent >= cap,
    byAgent: Object.values(byAgent).map((a) => ({ ...a, costUsd: round(a.costUsd) })).sort((a, b) => b.costUsd - a.costUsd),
    months,
    calls: now.reduce((s, r) => s + r.calls, 0),
  };
}

/** Admins and the owner (id + email) - owner-only data. */
async function listPeople() {
  if (router._testPeople) return router._testPeople();
  if (process.env.CC_FORCE_MEMORY_STORE === '1' || !config.supabase.url || !config.supabase.serviceKey) return [];
  const sb = require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey);
  const { data: roleRows } = await sb.from('user_roles').select('user_id, roles(name)');
  const roleOf = new Map();
  for (const r of roleRows || []) {
    const name = r.roles?.name;
    if (name === 'owner' || (name === 'admin' && roleOf.get(r.user_id) !== 'owner')) roleOf.set(r.user_id, name);
  }
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const emails = new Map((users?.users || []).map((u) => [u.id, u.email]));
  return [...roleOf.entries()].map(([id, role]) => ({ id, role, email: emails.get(id) || null }));
}

router.get('/me', async (req, res) => {
  try {
    const rows = await meter.summary(meter.monthStart());
    const cap = await meter.getCap(req.user.id);
    // Only the requester's own numbers leave this route.
    res.json({ estimated: true, month: meter.monthStart().slice(0, 7), ...describe(rows, { userId: req.user.id, cap }), months: undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', ownerOnly, async (req, res) => {
  try {
    const [rows, caps, people] = await Promise.all([meter.summary(sixMonthsAgo()), meter.listCaps(), listPeople()]);
    const capOf = (key) => {
      const c = caps.find((x) => x.user_id === key);
      return c && c.monthly_cap_usd !== null && c.monthly_cap_usd !== undefined ? Number(c.monthly_cap_usd) : null;
    };
    // Everyone with a role, plus anyone who spent this half-year but has no role now (e.g. removed).
    const ids = new Map(people.map((p) => [p.id, p]));
    for (const r of rows) if (r.user_id && !ids.has(r.user_id)) ids.set(r.user_id, { id: r.user_id, role: 'former', email: r.user_email || null });
    const admins = [...ids.values()].map((p) => ({ userId: p.id, email: p.email, role: p.role, ...describe(rows, { userId: p.id, cap: capOf(p.id) }) }))
      .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : b.spentUsd - a.spentUsd));
    const automated = { userId: 'automated', label: 'Automated (scheduler, webhooks)', ...describe(rows, { userId: null, cap: capOf(meter.AUTOMATED_CAP_KEY) }) };
    const total = round(admins.reduce((s, a) => s + a.spentUsd, 0) + automated.spentUsd);
    res.json({ estimated: true, month: meter.monthStart().slice(0, 7), months: lastSixMonths(), admins, automated, totalUsd: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** { monthly_cap_usd: number | null } - null clears the cap. */
router.put('/caps/:userId', ownerOnly, teamMutationLimiter, async (req, res) => {
  const target = req.params.userId;
  if (target !== 'automated' && !UUID.test(target)) return res.status(400).json({ error: 'Unknown user.' });
  const raw = req.body?.monthly_cap_usd;
  let cap = null;
  if (raw !== null && raw !== undefined && raw !== '') {
    cap = Number(raw);
    if (!Number.isFinite(cap) || cap < 0 || cap > 100000) return res.status(400).json({ error: 'Use an amount from 0 to 100000 (USD), or leave it empty for no cap.' });
    cap = Math.round(cap * 100) / 100;
  }
  try {
    const userId = target === 'automated' ? null : target;
    await meter.setCap(userId, cap, req.user.id);
    // Owner-only audit entry (hidden from everyone else by core/usage/visibility.js).
    const memory = require('../memory');
    await memory.audit(req.user.email || req.user.id, 'usage_cap_changed', target === 'automated' ? 'automated' : target, {
      monthlyCapUsd: cap, workspaceId: req.user.workspaceId || null,
    }).catch(() => {});
    res.json({ ok: true, userId: target, capUsd: cap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
