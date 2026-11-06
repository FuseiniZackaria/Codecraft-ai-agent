// Onboarding: the setup checklist ticks itself off from real data; steps can
// be skipped and brought back; the list can only be hidden once everything is
// done or skipped; the welcome shows once per workspace and the tour once per
// person; while only one WhatsApp number can be linked, other people see
// "not available yet" (and it doesn't count against them); each workspace has
// its own progress. Nothing real is sent.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
delete process.env.WAHA_MULTI_SESSION;
process.env.APP_OWNER_EMAIL = 'owner@codecraft.test';

const assert = require('assert');
const businessProfile = require('../core/businessProfile');
const kb = require('../core/knowledge/store');
const catalog = require('../core/catalog/store');
const waStore = require('../core/whatsapp/store');
const { sessionNameForUser } = require('../core/whatsapp');
const onboarding = require('../core/onboarding');

const WS = 'aaaaaaaa-0000-0000-0000-0000000000d1';
const OTHER = 'bbbbbbbb-0000-0000-0000-0000000000d2';
const OWNER = { id: '11111111-0000-0000-0000-000000000001', email: 'Owner@CodeCraft.test' };
const CLIENT = { id: '22222222-0000-0000-0000-000000000002', email: 'client@shop.test' };

const profiles = {};
businessProfile.getProfile = async (ws) => profiles[ws] || { business_name: null };
const byKey = (st) => Object.fromEntries(st.steps.map((s) => [s.key, s]));

(async () => {
  // 1. A new workspace: nothing done, welcome + tour to show.
  {
    const st = await onboarding.status(WS, OWNER);
    assert.strictEqual(st.steps.length, 6);
    assert.strictEqual(st.doneCount, 0);
    assert.strictEqual(st.total, 6);
    assert.strictEqual(st.showWelcome, true);
    assert.strictEqual(st.showTour, true);
    assert.strictEqual(st.complete, false);
    assert.deepStrictEqual(st.steps.map((s) => s.to), ['/settings', '/settings?tab=agent', '/settings?tab=qa', '/settings?tab=products', '/toolbox/connections', '/settings?tab=test']);
    console.log('✓ a new workspace starts at 0 of 6, with the welcome screen and the tour');
  }

  // 2. Steps tick themselves off from the real data.
  {
    profiles[WS] = { business_name: 'Ama Bakery' };
    await kb.addVersion(WS, { instructions: 'You are Ian.', agent_name: 'Ian', examples: [] });
    await kb.createQa(WS, { question: 'Do you deliver?', answer: 'Yes, in Accra.' });
    await catalog.createProduct(WS, { name: 'Chocolate cake', price: 150 });
    await kb.addTestMessage(WS, { role: 'customer', body: 'hi' });
    const st = byKey(await onboarding.status(WS, OWNER));
    for (const k of ['profile', 'agent', 'knowledge', 'products', 'test']) assert.strictEqual(st[k].done, true, k);
    assert.strictEqual(st.whatsapp.done, false);
    assert.strictEqual((await onboarding.status(WS, OWNER)).doneCount, 5);
    console.log('✓ profile, instructions, Q&A, products and Test chat tick themselves off');
  }

  // 3. WhatsApp: done when the workspace has a linked number.
  {
    await waStore.upsertSession({ session_name: sessionNameForUser(OWNER.id), user_id: OWNER.id, workspace_id: WS, status: 'WORKING' });
    const st = await onboarding.status(WS, OWNER);
    assert.strictEqual(byKey(st).whatsapp.done, true);
    assert.strictEqual(st.doneCount, 6);
    assert.strictEqual(st.allDone, true);
    assert.strictEqual(st.complete, true);
    console.log('✓ Connect WhatsApp ticks off once the number is linked - 6 of 6');
  }

  // 4. One WhatsApp number for now: someone else sees "not available yet", not counted.
  {
    const st = await onboarding.status(OTHER, CLIENT);
    const wa = byKey(st).whatsapp;
    assert.strictEqual(wa.unavailable, true);
    assert.strictEqual(wa.done, false);
    assert.strictEqual(st.total, 5, 'the WhatsApp step does not count against them');
    const { canConnectWhatsapp } = require('../core/whatsapp');
    assert.strictEqual(await canConnectWhatsapp(OWNER), true, 'the app owner can connect');
    assert.strictEqual(await canConnectWhatsapp(CLIENT), false, 'others cannot - yet');
    console.log('✓ while only one number can be linked, other workspaces see "not available yet" (5 steps, not 6)');
  }

  // 5. Skip for now / put back; hiding needs everything done or skipped.
  {
    let st = await onboarding.status(OTHER, CLIENT);
    assert.strictEqual(st.complete, false);
    for (const k of ['profile', 'agent', 'knowledge', 'products']) await onboarding.setSkipped(OTHER, k, true);
    st = await onboarding.status(OTHER, CLIENT);
    assert.strictEqual(byKey(st).profile.skipped, true);
    assert.strictEqual(st.complete, false, 'Test chat is still to do');
    await onboarding.setHidden(OTHER, true);
    assert.strictEqual((await onboarding.status(OTHER, CLIENT)).checklistHidden, false, "can't hide it before everything is done or skipped");
    await onboarding.setSkipped(OTHER, 'test', true);
    st = await onboarding.status(OTHER, CLIENT);
    assert.strictEqual(st.complete, true);
    assert.strictEqual(st.allDone, false);
    assert.strictEqual(st.checklistHidden, true);
    await onboarding.setSkipped(OTHER, 'profile', false);
    st = await onboarding.status(OTHER, CLIENT);
    assert.strictEqual(byKey(st).profile.skipped, false, 'a skipped step can be put back');
    assert.strictEqual(st.checklistHidden, false, 'and the list comes back');
    await assert.rejects(() => onboarding.setSkipped(OTHER, 'nonsense'), /Unknown step/);
    console.log('✓ steps can be skipped and put back; the list hides only once everything is done or skipped');
  }

  // 6. A skipped step that gets done counts as done.
  {
    profiles[OTHER] = { business_name: 'Kofi Shoes' };
    await onboarding.setSkipped(OTHER, 'profile', true);
    const p = byKey(await onboarding.status(OTHER, CLIENT)).profile;
    assert.strictEqual(p.done, true);
    assert.strictEqual(p.skipped, false);
    console.log('✓ doing a skipped step ticks it off');
  }

  // 7. Welcome once per workspace; tour once per person.
  {
    await onboarding.markWelcomeSeen(WS);
    await onboarding.markWelcomeSeen(WS);
    let st = await onboarding.status(WS, OWNER);
    assert.strictEqual(st.showWelcome, false);
    assert.strictEqual(st.showTour, true);
    await onboarding.markTourSeen(WS, OWNER.id);
    st = await onboarding.status(WS, OWNER);
    assert.strictEqual(st.showTour, false);
    const teammate = { id: '33333333-0000-0000-0000-000000000003', email: 'team@codecraft.test' };
    const forTeammate = await onboarding.status(WS, teammate);
    assert.strictEqual(forTeammate.showWelcome, false, 'the workspace already saw the welcome');
    assert.strictEqual(forTeammate.showTour, true, 'a new team member still gets the tour once');
    console.log('✓ the welcome shows once per workspace; the tour once per person');
  }

  // 8. Each workspace has its own progress.
  {
    const a = await onboarding.status(WS, OWNER);
    const b = await onboarding.status(OTHER, CLIENT);
    assert.strictEqual(a.showWelcome, false);
    assert.strictEqual(b.showWelcome, true, "OTHER hasn't seen its welcome");
    assert.strictEqual(byKey(a).products.done, true);
    assert.strictEqual(byKey(b).products.done, false, "WS's products don't count for OTHER");
    assert.strictEqual(byKey(a).profile.skipped, false);
    console.log('✓ each workspace has its own checklist and progress');
  }

  console.log('\nAll onboarding tests passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
