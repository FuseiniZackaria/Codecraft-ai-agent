// Step 6, end to end: a customer's WhatsApp message goes in through the real
// message path, and the agent is given the business profile, the saved
// instructions and example replies, the switched-on Q&A and the documents that
// processed fine - never switched-off Q&A or failed documents. When it doesn't
// know, the customer gets the "team will follow up" message and the owner is
// asked to approve; made-up details (times, phone numbers, links) never go out.
// Nothing real is sent - WAHA, the AI and the alerts are stubbed.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
process.env.WAHA_WEBHOOK_SECRET = 'test-webhook-secret';
delete process.env.WA_AUTO_REPLY;

const assert = require('assert');
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const notifications = require('../core/notifications');
const memory = require('../memory');
const businessProfile = require('../core/businessProfile');
const store = require('../core/knowledge/store');
const agentSettings = require('../core/knowledge/agentSettings');
const waha = require('../core/whatsapp/WahaProvider');
const messaging = require('../core/whatsapp/messaging');

const WS = 'aaaaaaaa-0000-0000-0000-0000000000f1';

let modelAnswer = '';
let lastPrompt = null;
mockProvider.complete = async (req) => { lastPrompt = req; return { provider: 'mock', text: modelAnswer, costEstimate: 0 }; };
const sent = [];
orchestrator.approveTask = async (taskId) => { const t = await memory.getTask(taskId); sent.push(t.payload.body); return { ...t, status: 'done' }; };
const pending = [];
const fyi = [];
notifications.notifyOwnerPendingApproval = async (a) => { pending.push(a); return {}; };
notifications.notifyOwnerFyi = async (a) => { fyi.push(a); return 'sent'; };
notifications.notifyOwnerAttention = async () => ({});
waha.sendMessage = async () => ({ id: 'x' });
waha.sendTyping = async () => {};
messaging.timing.sleep = async () => {};

memory.getBusinessProfile = async ({ workspaceId }) => (workspaceId === WS ? {
  business_name: 'Ama Bakery', display_name: 'Ama Mensah', offers: 'Bread, cakes and pastries', location: 'Osu, Accra',
  phone: '0244 555 123', website: 'amabakery.com', signature: 'Ama Mensah\nOwner',
} : null);

let n = 0;
function reset() { sent.length = 0; pending.length = 0; fyi.length = 0; }
const say = async (text) => (await messaging.handleIncomingMessage({
  providerName: 'waha', sessionName: 'default', userId: 'admin-1', workspaceId: WS,
  message: { waMessageId: `m-${++n}`, contactNumber: '233200000077', contactName: 'Kofi', text, timestamp: new Date(Date.now() + n * 1000).toISOString() },
})).reply;
const answer = (reply, hold = false, reason = '', sources = []) => JSON.stringify({ reply, hold, reason, sources });

(async () => {
  businessProfile.invalidate();
  await agentSettings.save(WS, {
    agent_name: 'Esi',
    instructions: '## Who you are\nYou are {{agent_name}} from {{business_name}}.\n\n## Never do this\n- Never offer discounts.',
    examples: [{ customer: 'Do you have bread today?', reply: 'Yes! Fresh loaves came out at 7am.' }],
    hold_reply: 'Thanks for asking - a team member will follow up with you shortly.',
  }, { id: 'admin-1' });
  await store.createQa(WS, { question: 'Do you deliver?', answer: 'Yes, within Accra for GHS 20.' });
  await store.createQa(WS, { question: 'Do you sell pizza?', answer: 'SECRET-OFF-ENTRY', enabled: false });
  await store.createDocument(WS, { id: 'doc-ok', filename: 'hours.txt', storage_path: 'a', status: 'ready', chunk_count: 1, char_count: 60 });
  await store.replaceChunks(WS, 'doc-ok', ['Opening hours: Monday to Saturday 7am to 6pm. Closed on Sunday.']);
  await store.createDocument(WS, { id: 'doc-bad', filename: 'old.pdf', storage_path: 'b', status: 'failed', chunk_count: 0, char_count: 0 });

  // 1. Everything the business set up reaches the agent - and nothing switched off or failed.
  {
    reset();
    modelAnswer = answer('Good morning! Yes, we deliver within Accra.', false, '', ['Q1']);
    const r = await say('Good morning, do you deliver?');
    assert(r && r.autoSent, JSON.stringify(r));
    const s = lastPrompt.system;
    assert(s.includes('You are Esi from Ama Bakery.'), 'instructions with names filled in');
    assert(s.includes('Never offer discounts.'), 'the "never do this" rules');
    assert(s.includes('Customer: Do you have bread today?\nEsi: Yes! Fresh loaves came out at 7am.'), 'example replies');
    assert(s.includes('Business: Ama Bakery') && s.includes('Location: Osu, Accra') && s.includes('Phone: 0244 555 123'), 'business profile');
    assert(s.includes('Offers: Bread, cakes and pastries'));
    assert(!s.includes('Ama Mensah') && !s.includes('Owner'), "the owner's name and email signature stay out of WhatsApp");
    assert(s.includes('Yes, within Accra for GHS 20.'), 'switched-on Q&A');
    assert(!s.includes('SECRET-OFF-ENTRY'), 'switched-off Q&A never');
    assert(s.includes('(hours.txt)') && s.includes('Monday to Saturday 7am to 6pm'), 'ready documents');
    assert(!s.includes('old.pdf'), 'failed documents never');
    assert(/don't guess/i.test(s), 'told never to guess');
    assert.deepStrictEqual(sent, ['Good morning! Yes, we deliver within Accra.'], 'a known answer goes straight out');
    assert.strictEqual(fyi.length, 1, 'with an FYI to the owner');
    console.log('✓ the agent gets the profile, instructions, examples, switched-on Q&A and ready documents (never off/failed ones)');
  }

  // 2. Doesn't know -> the customer is told a team member will follow up; the owner approves.
  {
    reset();
    modelAnswer = answer('I think we might have gluten-free options.', true, "I don't know if we sell gluten-free bread");
    const r = await say('Do you have gluten-free bread?');
    assert.strictEqual(r.held, true);
    assert.deepStrictEqual(sent, ['Thanks for asking - a team member will follow up with you shortly.']);
    assert.strictEqual(pending.length, 1, 'the owner is asked');
    assert(/don't know/.test(pending[0].reason), pending[0].reason);
    assert.strictEqual(pending[0].customerToldText, 'Thanks for asking - a team member will follow up with you shortly.');
    console.log('✓ when the agent doesn\'t know, the customer hears "a team member will follow up" and you approve the answer');
  }

  // 3. Made-up details never go out, even if the AI forgets to hold.
  {
    for (const [question, invented, why] of [
      ['When do you close on Saturday?', 'We close at 9pm on Saturdays.', /time \(9pm\)/],
      ['What is your number?', 'Call us on 0200 111 222.', /phone number/],
      ['Do you have a website?', 'Visit amabakery-shop.com to order.', /link/],
    ]) {
      reset();
      modelAnswer = answer(invented);
      const r = await say(question);
      assert.strictEqual(r.held, true, `${invented} -> ${r.reason}`);
      assert(why.test(r.reason), r.reason);
      assert(!sent.includes(invented), 'the invented reply is never sent');
    }
    reset();
    modelAnswer = answer('We are open until 6pm on Saturdays. You can call 0244 555 123 or visit amabakery.com.');
    const ok = await say('Hours on Saturday, and your number?');
    assert.strictEqual(ok.held, false, `details from the knowledge are fine: ${ok.reason}`);
    console.log('✓ a time, phone number or link that isn\'t in your knowledge is never sent - the reply waits for you');
  }

  // 4. A change in the dashboard applies on the very next message.
  {
    reset();
    await store.createQa(WS, { question: 'Do you sell meat pies?', answer: 'Yes, GHS 15 each, fresh every morning.' });
    modelAnswer = answer('Yes, fresh every morning!');
    await say('Meat pies?');
    assert(lastPrompt.system.includes('GHS 15 each, fresh every morning.'), 'new Q&A used immediately');
    await agentSettings.save(WS, { agent_name: 'Esi', instructions: 'You are {{agent_name}}. Reply in one short sentence.' }, { id: 'admin-1' });
    await say('Thanks');
    assert(lastPrompt.system.includes('You are Esi. Reply in one short sentence.'), 'new instructions used immediately');
    console.log('✓ edits in the dashboard reach the live agent on its very next message - no redeploy');
  }

  console.log('All end-to-end knowledge checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
