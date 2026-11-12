// Owner role, per-admin API usage and monthly caps (migration 0013):
// - a regular admin gets 403 on /team and /usage, and never sees other admins
//   (events, audit, ids/emails in answers); /usage/me is only their own numbers;
// - an admin at their cap is blocked, and works again once the owner raises it;
// - the scheduler's AI calls go to the "automated" bucket;
// - a failed usage write never breaks the request; costs are computed right.
// The Anthropic SDK is faked - no network, no spend.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.APP_OWNER_EMAIL = '';

const assert = require('assert');
const express = require('express');

// --- Fake Anthropic SDK: every call answers "ok" with fixed token counts ---
const sdkPath = require.resolve('@anthropic-ai/sdk');
class FakeAnthropic {
  constructor() {
    this.beta = {
      messages: {
        stream: (params) => {
          const final = { model: params.model, stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1_000_000, output_tokens: 100_000 } };
          return {
            async *[Symbol.asyncIterator]() { yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }; },
            finalMessage: async () => final,
          };
        },
      },
    };
  }
}
require(sdkPath);
require.cache[sdkPath].exports = FakeAnthropic;

const config = require('../config');
config.llm.provider = 'anthropic';
config.llm.anthropicKey = 'sk-test';
config.anthropic.model = 'claude-sonnet-5-5';
config.assistant.dailyUsdCap = 0;

const meter = require('../core/usage/meter');
const usageContext = require('../core/usage/context');
const { requireRole } = require('../core/auth');
const { hideOtherPeople, canSee } = require('../core/usage/visibility');
const memory = require('../memory');
const usage = require('../core/assistant/usage');
const PRICES = require('../config/aiPrices');

const WS = 'ws-shared';
const OWNER = { id: '11111111-1111-4111-8111-111111111111', email: 'boss@example.com', role: 'owner', workspaceId: WS };
const ALICE = { id: '22222222-2222-4222-8222-222222222222', email: 'alice@example.com', role: 'admin', workspaceId: WS };
const BOB = { id: '33333333-3333-4333-8333-333333333333', email: 'bob@example.com', role: 'admin', workspaceId: WS };
const PEOPLE = { 'x-owner': OWNER, 'x-alice': ALICE, 'x-bob': BOB };

// Same mounts as server.js, with a fake login (x-who header) in place of Supabase.
function fakeAuth(req, res, next) {
  const user = PEOPLE[req.headers['x-who']];
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = { ...user };
  usageContext.runForUser(req.user, next);
}
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', hideOtherPeople);
  app.use('/api/events', fakeAuth, requireRole('admin'), require('../api/eventsRoutes'));
  app.use('/api/team', fakeAuth, requireRole('owner'), require('../api/teamRoutes'));
  const usageRoutes = require('../api/usageRoutes');
  usageRoutes._testPeople = async () => [
    { id: OWNER.id, role: 'owner', email: OWNER.email },
    { id: ALICE.id, role: 'admin', email: ALICE.email },
    { id: BOB.id, role: 'admin', email: BOB.email },
  ];
  app.use('/api/usage', fakeAuth, requireRole('admin'), usageRoutes);
  // A route that answers with person fields, like knowledge versions or video jobs do.
  app.get('/api/sample', fakeAuth, requireRole('admin'), (req, res) => res.json({
    items: [
      { id: 1, created_by: ALICE.id, created_by_email: ALICE.email, email: 'lead@shop.com' },
      { id: 2, created_by: BOB.id, created_by_email: BOB.email, user_id: BOB.id, email: 'other-lead@shop.com' },
    ],
  }));
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (who, method, path, body) => {
    const r = await fetch(base + path, {
      method, headers: { 'x-who': who, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, body: json, text };
  };
  try { return await fn(call); } finally { server.close(); }
}

const aiProvider = require('../core/providers/aiProvider');
const askAs = (user, extra = {}) => usageContext.runForUser(user, () => usageContext.withDetails(extra, () => aiProvider.complete({ prompt: 'hi' })));

async function main() {
  meter._reset();

  // --- Cost calculation ---
  const p = PRICES['claude-sonnet-5-5'];
  assert.ok(p && typeof p.input === 'number' && typeof p.output === 'number', 'sonnet has a price in config/aiPrices.js');
  const expected = (1_000_000 / 1e6) * p.input + (100_000 / 1e6) * p.output;
  assert.ok(Math.abs(usage.costOf('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 }) - expected) < 1e-9, 'costOf = tokens x per-million price');
  await askAs(ALICE, { agent: 'marketing' });
  const aliceRows = meter._mem.rows.filter((r) => r.user_id === ALICE.id);
  assert.strictEqual(aliceRows.length, 1, 'one usage row per real AI call');
  assert.strictEqual(aliceRows[0].user_email, ALICE.email);
  assert.strictEqual(aliceRows[0].agent, 'marketing');
  assert.strictEqual(aliceRows[0].provider, 'anthropic');
  assert.strictEqual(aliceRows[0].input_tokens, 1_000_000);
  assert.ok(Math.abs(aliceRows[0].cost_usd - expected) < 1e-6, `row cost ${aliceRows[0].cost_usd} = ${expected}`);
  console.log('  ok  cost calculation and attribution');

  // --- A failed usage write never breaks the request ---
  meter.testing.failWrites = true;
  const r2 = await askAs(BOB);
  assert.ok(r2, 'the AI call still answers');
  meter.testing.failWrites = false;
  assert.strictEqual(meter._mem.rows.filter((r) => r.user_id === BOB.id).length, 0, 'nothing written');
  assert.strictEqual(await meter.record({ provider: 'x', costUsd: 1 }).then(() => 'fine'), 'fine', 'record never throws');
  console.log('  ok  usage write failure does not break the request');

  // --- Scheduler work goes to "automated" (even if started inside a user's request) ---
  const stubs = { './catalog': 'tickDailySync', './leads': 'tick', './emailBounces': 'tick', './video/jobs': 'tick' };
  let schedulerCalled = false;
  for (const [mod, fn] of Object.entries(stubs)) {
    const m = require(require('path').join(__dirname, '../core', mod));
    m[fn] = mod === './leads'
      ? async () => { schedulerCalled = true; await aiProvider.complete({ prompt: 'follow up' }); }
      : async () => {};
  }
  const scheduler = require('../core/scheduler');
  await usageContext.runForUser(ALICE, () => scheduler.start());
  for (let i = 0; i < 50 && !meter._mem.rows.some((r) => r.user_id === null); i++) await new Promise((r) => setTimeout(r, 20));
  scheduler.stop();
  assert.ok(schedulerCalled, 'the stubbed scheduler job ran');
  const auto = meter._mem.rows.filter((r) => r.user_id === null);
  assert.strictEqual(auto.length, 1, 'the scheduler call is recorded once');
  assert.strictEqual(auto[0].user_email, null, 'automated rows carry no person');
  console.log('  ok  scheduler usage is attributed to "automated"');

  await withServer(buildApp(), async (call) => {
    // --- Owner-only routes ---
    assert.strictEqual((await call('x-alice', 'GET', '/api/team')).status, 403, 'admin: 403 on /team');
    assert.strictEqual((await call('x-alice', 'GET', '/api/usage')).status, 403, 'admin: 403 on /usage');
    assert.strictEqual((await call('x-alice', 'PUT', `/api/usage/caps/${BOB.id}`, { monthly_cap_usd: 1 })).status, 403, 'admin cannot set caps');
    console.log('  ok  regular admin gets 403 on /team and /usage');

    // --- /usage/me: only their own numbers ---
    const me = await call('x-alice', 'GET', '/api/usage/me');
    assert.strictEqual(me.status, 200);
    assert.ok(Math.abs(me.body.spentUsd - Math.round(expected * 10000) / 10000) < 1e-6, 'own spend');
    assert.ok(me.body.estimated, 'labelled estimated');
    assert.ok(!/bob@|boss@/.test(me.text) && !me.text.includes(BOB.id) && !me.text.includes(OWNER.id), 'no one else in /usage/me');
    console.log('  ok  /usage/me returns only their own data');

    // --- Owner sees everyone + automated + total ---
    const all = await call('x-owner', 'GET', '/api/usage');
    assert.strictEqual(all.status, 200);
    const alice = all.body.admins.find((a) => a.userId === ALICE.id);
    assert.strictEqual(alice.email, ALICE.email);
    assert.strictEqual(alice.byAgent[0].agent, 'marketing');
    assert.strictEqual(alice.months.length, 6);
    assert.ok(all.body.automated.spentUsd > 0, 'automated row has the scheduler spend');
    assert.ok(Math.abs(all.body.totalUsd - (alice.spentUsd + all.body.automated.spentUsd)) < 1e-3, 'total adds up');
    console.log('  ok  owner sees every admin, automated and the total');

    // --- Cap: blocked at the cap, allowed after the owner raises it ---
    const bad = await call('x-owner', 'PUT', `/api/usage/caps/${ALICE.id}`, { monthly_cap_usd: -5 });
    assert.strictEqual(bad.status, 400, 'negative caps are refused');
    const set = await call('x-owner', 'PUT', `/api/usage/caps/${ALICE.id}`, { monthly_cap_usd: expected });
    assert.strictEqual(set.status, 200);
    await assert.rejects(askAs(ALICE), (err) => err.code === 'USAGE_CAP_REACHED' && err.message === 'Monthly API credit cap reached. Ask the owner to raise it.');
    const meBlocked = await call('x-alice', 'GET', '/api/usage/me');
    assert.ok(meBlocked.body.blocked && meBlocked.body.percent >= 100, 'meter shows blocked');
    assert.ok(await askAs(BOB), 'other admins are not affected');
    await call('x-owner', 'PUT', `/api/usage/caps/${ALICE.id}`, { monthly_cap_usd: expected * 10 });
    assert.ok(await askAs(ALICE), 'allowed again after the owner raises the cap');
    const meWarn = await call('x-alice', 'GET', '/api/usage/me');
    assert.ok(!meWarn.body.blocked, 'no longer blocked');
    await call('x-owner', 'PUT', `/api/usage/caps/${ALICE.id}`, { monthly_cap_usd: null });
    assert.strictEqual(await meter.getCap(ALICE.id), null, 'null clears the cap');
    // The automated bucket can be capped too.
    assert.strictEqual((await call('x-owner', 'PUT', '/api/usage/caps/automated', { monthly_cap_usd: 0 })).status, 200);
    await assert.rejects(usageContext.runAutomated(() => aiProvider.complete({ prompt: 'x' })), (err) => err.code === 'USAGE_CAP_REACHED');
    await call('x-owner', 'PUT', '/api/usage/caps/automated', { monthly_cap_usd: null });
    console.log('  ok  blocked at the cap, allowed after the owner raises it');

    // --- Audit + events: no team/usage entries and no other emails for admins ---
    await memory.audit(BOB.email, 'admin_added', 'carol@example.com', { workspaceId: WS });
    await memory.audit(BOB.email, 'goal_submitted', 'something', { workspaceId: WS });
    await memory.audit('marketing', 'task_completed', 'x', { workspaceId: WS });
    await memory.audit(ALICE.email, 'goal_submitted', 'mine', { workspaceId: WS });
    const ev = await call('x-alice', 'GET', '/api/events/recent?limit=500');
    assert.strictEqual(ev.status, 200);
    const actions = ev.body.map((e) => e.action);
    assert.ok(!actions.some((a) => /^(admin_|usage_cap|team_|invite_|account_|role_)/.test(a)), `no team/usage entries for an admin: ${actions}`);
    assert.ok(!/bob@|boss@|carol@/.test(ev.text), 'no other emails in the admin\'s events');
    assert.ok(actions.includes('task_completed') && ev.text.includes(ALICE.email), 'their own and agent entries stay');
    const evOwner = await call('x-owner', 'GET', '/api/events/recent?limit=500');
    assert.ok(evOwner.body.some((e) => e.action === 'usage_cap_changed') && evOwner.body.some((e) => e.action === 'admin_added'), 'the owner sees team and cap changes');
    // Live stream filter.
    assert.strictEqual(canSee({ action: 'usage_cap_changed', actor: OWNER.email }, ALICE), false);
    assert.strictEqual(canSee({ action: 'goal_submitted', actor: BOB.email }, ALICE), false);
    assert.strictEqual(canSee({ action: 'goal_submitted', actor: ALICE.email }, ALICE), true);
    assert.strictEqual(canSee({ action: 'admin_added', actor: BOB.email }, OWNER), true);
    console.log('  ok  events and audit hide team/usage entries and other emails');

    // --- Other people's ids/emails are blanked in answers to admins ---
    const s = await call('x-alice', 'GET', '/api/sample');
    assert.strictEqual(s.body.items[0].created_by, ALICE.id, 'own id stays');
    assert.strictEqual(s.body.items[0].created_by_email, ALICE.email, 'own email stays');
    assert.strictEqual(s.body.items[1].created_by, null);
    assert.strictEqual(s.body.items[1].created_by_email, null);
    assert.strictEqual(s.body.items[1].user_id, null);
    assert.strictEqual(s.body.items[1].email, 'other-lead@shop.com', 'lead/contact emails are not people of this app');
    const so = await call('x-owner', 'GET', '/api/sample');
    assert.strictEqual(so.body.items[1].created_by_email, BOB.email, 'the owner sees everyone');
    console.log('  ok  other admins\' ids and emails are hidden from admins');
  });

  console.log('\nusage-caps: all checks passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
