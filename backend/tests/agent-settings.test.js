// Agent instructions (Settings -> General -> Agent instructions): per-workspace
// instructions, example replies and hold reply with version history and
// roll back; changes reach the WhatsApp agent on its very next reply; one
// workspace never sees another's; the email agents get the "Email & outreach
// tone" section; a missing migration falls back to whatsapp-voice.md.
// Nothing real is sent - the AI, the send path and the alerts are stubbed.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
delete process.env.WA_AUTO_REPLY;
delete process.env.WA_VOICE_FILE;

const assert = require('assert');
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const notifications = require('../core/notifications');
const memory = require('../memory');
const businessProfile = require('../core/businessProfile');
const store = require('../core/knowledge/store');
const agentSettings = require('../core/knowledge/agentSettings');
const { canEditKnowledge, requireKnowledgeEditor } = require('../core/workspaceAccess');
const WhatsAppAgent = require('../agents/whatsapp/WhatsAppAgent');

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const WS_B = 'bbbbbbbb-0000-0000-0000-000000000002';

let modelAnswer = JSON.stringify({ reply: 'Good morning! How can I help?', hold: false, reason: '' });
let lastPrompt = null;
mockProvider.complete = async (req) => { lastPrompt = req; return { provider: 'mock', text: modelAnswer, costEstimate: 0 }; };
const sent = [];
orchestrator.approveTask = async (taskId) => { const t = await memory.getTask(taskId); sent.push(t.payload.body); return { ...t, status: 'done' }; };
notifications.notifyOwnerFyi = async () => 'sent';
notifications.notifyOwnerPendingApproval = async () => ({});
notifications.notifyOwnerAttention = async () => ({});

const profiles = {
  [WS_A]: { business_name: 'Ama Bakery', display_name: 'Ama Mensah', tone: 'Old tone text' },
  [WS_B]: { business_name: 'Kojo Motors', display_name: 'Kojo Asante' },
};
memory.getBusinessProfile = async ({ workspaceId }) => profiles[workspaceId] || null;

const user = { id: 'user-1', email: 'owner@example.com' };
const agent = new WhatsAppAgent();
const ask = (workspaceId, body = 'Hello') => agent.handleIncomingMessage({ from: '233200000009', body, workspaceId, session: 'default', userId: 'admin-1' });

(async () => {
  businessProfile.invalidate();

  // 1. Nothing saved yet: the neutral template, filled in with this business's name.
  {
    const s = await agentSettings.getActive(WS_A);
    assert.strictEqual(s.source, 'default');
    await ask(WS_A);
    assert(lastPrompt.system.includes('You are Ian, the WhatsApp assistant for Ama Bakery'), 'placeholders filled in');
    assert(!/CodeCraft|Zackman|Akwaaba/.test(lastPrompt.system), 'nothing from another business in the template');
    console.log('✓ default: a neutral starting template with the business name filled in');
  }

  // 2. Save -> the very next reply uses it (no restart, no waiting for a cache).
  {
    await agentSettings.getActive(WS_A); // warm the cache
    const v1 = await agentSettings.save(WS_A, {
      agent_name: 'Esi',
      instructions: '## Who you are\nYou are {{agent_name}} from {{business_name}}. Always mention our fresh bread.\n<!-- note to self: never sent -->',
      examples: [{ customer: 'Do you deliver?', reply: 'Yes! We deliver within Accra.' }, { customer: '', reply: '' }],
      hold_reply: 'One moment, a team member will follow up.',
      note: 'First try',
    }, user);
    assert.strictEqual(v1.version, 1);
    assert.deepStrictEqual(v1.examples, [{ customer: 'Do you deliver?', reply: 'Yes! We deliver within Accra.' }], 'blank example rows dropped');
    await ask(WS_A);
    assert(lastPrompt.system.includes('You are Esi from Ama Bakery. Always mention our fresh bread.'));
    assert(!lastPrompt.system.includes('note to self'), '<!-- notes --> are never sent');
    assert(lastPrompt.system.includes('Customer: Do you deliver?\nEsi: Yes! We deliver within Accra.'), 'example replies in the prompt');
    console.log('✓ save: the next reply uses the new instructions and examples');
  }

  // 3. A held reply sends the customer nothing; the agent's own name is allowed.
  {
    sent.length = 0;
    modelAnswer = JSON.stringify({ reply: "Hi, I'm Esi from Ama Bakery. Let me confirm that cake price.", hold: false, reason: '' });
    const r = await ask(WS_A, 'How much is a wedding cake?');
    assert.strictEqual(r.held, true);
    assert.deepStrictEqual(sent, [], 'held: nothing is sent - never "let me check with the team"');
    modelAnswer = JSON.stringify({ reply: "Good morning! I'm Esi from Ama Bakery - happy to help.", hold: false, reason: '' });
    const ok = await ask(WS_A, 'Hi there');
    assert.strictEqual(ok.held, false, `the agent's own name is fine: ${ok.reason}`);
    console.log('✓ held replies send nothing; the agent name comes from the saved version');
  }

  // 4. Versions, preview and roll back (roll back adds a new version - history kept).
  {
    await agentSettings.save(WS_A, { agent_name: 'Esi', instructions: 'Version two text', hold_reply: '' }, user);
    let list = await store.listVersions(WS_A);
    assert.deepStrictEqual(list.map((v) => v.version), [2, 1]);
    assert.strictEqual(list[1].note, 'First try');
    assert.strictEqual(list[0].created_by_email, 'owner@example.com');
    assert.strictEqual((await agentSettings.getActive(WS_A)).holdReply, agentSettings.DEFAULT_HOLD, 'empty hold reply -> the standard one');

    const v1 = list.find((v) => v.version === 1);
    const restored = await agentSettings.restore(WS_A, v1.id, user);
    assert.strictEqual(restored.version, 3);
    assert.strictEqual(restored.note, 'Rolled back to version 1');
    const active = await agentSettings.getActive(WS_A);
    assert(active.instructions.includes('fresh bread'));
    assert.strictEqual(active.holdReply, 'One moment, a team member will follow up.');
    list = await store.listVersions(WS_A);
    assert.deepStrictEqual(list.map((v) => v.version), [3, 2, 1], 'nothing deleted');
    await assert.rejects(agentSettings.restore(WS_A, 'no-such-id', user), (e) => e.code === 'NOT_FOUND');
    console.log('✓ version history: every save is kept; roll back restores an old version as the newest');
  }

  // 5. Workspaces are separate.
  {
    assert.strictEqual((await agentSettings.getActive(WS_B)).source, 'default');
    assert.deepStrictEqual(await store.listVersions(WS_B), []);
    const a1 = (await store.listVersions(WS_A))[0];
    assert.strictEqual(await store.getVersion(WS_B, a1.id), null, "B can't open A's version by id");
    await assert.rejects(agentSettings.restore(WS_B, a1.id, user), (e) => e.code === 'NOT_FOUND');
    await ask(WS_B);
    assert(lastPrompt.system.includes('Kojo Motors') && !lastPrompt.system.includes('fresh bread'));
    console.log('✓ one workspace never sees or changes another\'s instructions');
  }

  // 6. Validation.
  {
    const bad = agentSettings.validate({ instructions: '   ', examples: [{ customer: 'Hi' }], agent_name: 'x'.repeat(41) });
    assert.strictEqual(bad.errors.length, 3, bad.errors.join(' | '));
    await assert.rejects(agentSettings.save(WS_A, { instructions: '' }, user), (e) => e.code === 'INVALID');
    assert.strictEqual(agentSettings.validate({ instructions: 'x'.repeat(20001) }).errors.length, 1);
    console.log('✓ validation: empty instructions, half-filled examples and over-long text are rejected');
  }

  // 7. Email/outreach agents: the "Email & outreach tone" section, else the old tone field.
  {
    businessProfile.invalidate();
    let line = await businessProfile.profileContextLine(WS_A);
    assert(line.includes('Tone: Old tone text'), 'no tone section yet -> the old Voice & tone value');
    await agentSettings.save(WS_A, { instructions: '## Who you are\nEsi.\n\n## Email & outreach tone\nWarm and brief, one clear benefit.' }, user);
    line = await businessProfile.profileContextLine(WS_A);
    assert(line.includes('Tone: Warm and brief, one clear benefit.'));
    assert(!line.includes('Old tone text'));
    assert(!(await businessProfile.profileContextLine(WS_A, { forChat: true })).includes('Tone:'), 'WhatsApp gets the full instructions instead');
    console.log('✓ email/outreach agents read the "Email & outreach tone" section');
  }

  // 8. Migration not run yet: the old whatsapp-voice.md keeps the agent working.
  {
    const real = store.getLatestVersion;
    store.getLatestVersion = async () => { const e = new Error('missing'); e.code = 'MIGRATION_MISSING'; throw e; };
    agentSettings.invalidate();
    const s = await agentSettings.getActive(WS_B);
    assert.strictEqual(s.source, 'file');
    assert(s.instructions.includes('Ian from CodeCraft'));
    store.getLatestVersion = real;
    agentSettings.invalidate();
    assert.strictEqual((await agentSettings.getActive(WS_B)).source, 'default', 'recovers once the tables exist');
    assert.strictEqual((await agentSettings.getActive(null)).source, 'file', 'no workspace -> the voice file');
    console.log('✓ before migration 0006 (or without a workspace) the agent uses whatsapp-voice.md as before');
  }

  // 9. Permissions: owner/editor of the workspace only.
  {
    assert.strictEqual(canEditKnowledge({ workspaceId: WS_A, workspaceRole: 'owner' }), true);
    assert.strictEqual(canEditKnowledge({ workspaceId: WS_A, workspaceRole: 'editor' }), true);
    assert.strictEqual(canEditKnowledge({ workspaceId: WS_A, workspaceRole: 'member' }), false);
    assert.strictEqual(canEditKnowledge({ workspaceId: null, workspaceRole: 'owner', role: 'admin' }), false);
    const run = (u) => {
      let status = 200; let nextCalled = false;
      const res = { status(s) { status = s; return this; }, json() { return this; } };
      requireKnowledgeEditor({ user: u }, res, () => { nextCalled = true; });
      return nextCalled ? 'next' : status;
    };
    assert.strictEqual(run({ workspaceId: WS_A, workspaceRole: 'owner' }), 'next');
    assert.strictEqual(run({ workspaceId: null }), 400);
    assert.strictEqual(run({ workspaceId: WS_A, workspaceRole: 'member' }), 403);
    console.log('✓ permissions: only the workspace\'s owner or an editor can change its knowledge base');
  }

  // 10. The "who are you?" bug: Agent's name box "Zackaria" (the owner's name), instructions "You are Ian".
  {
    const WS_C = 'cccccccc-0000-0000-0000-00000000000c';
    profiles[WS_C] = { business_name: 'codecraftgh', display_name: 'Fuseini Zackaria' };
    const store2 = require('../core/knowledge/store');
    // Saved before this check existed (straight into the store):
    await store2.addVersion(WS_C, { agent_name: 'Zackaria', instructions: '## Who you are\n- You are Ian from CodeCraft, CodeCraft\'s assistant.' });
    agentSettings.invalidate(WS_C);
    assert.strictEqual((await agentSettings.getActive(WS_C)).agentName, 'Ian', 'the instructions win');
    sent.length = 0;
    modelAnswer = JSON.stringify({ reply: "I'm Ian, CodeCraft's AI assistant. How can I help?", hold: false, reason: '' });
    const r = await ask(WS_C, 'Who are you?');
    assert.strictEqual(r.held, false, `"I'm Ian" must not be held: ${r.reason}`);
    assert.deepStrictEqual(sent, ["I'm Ian, CodeCraft's AI assistant. How can I help?"]);
    // And saving such a mismatch is now refused with a clear reason.
    await assert.rejects(
      agentSettings.save(WS_C, { agent_name: 'Zackaria', instructions: '- You are Ian from CodeCraft.' }, user),
      (e) => e.code === 'INVALID' && /instructions say "You are Ian"/.test(e.message),
    );
    console.log('✓ "Who are you?" is answered even if the name box says the owner\'s name; saving that mismatch is refused');
  }

  console.log('All agent-settings checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
