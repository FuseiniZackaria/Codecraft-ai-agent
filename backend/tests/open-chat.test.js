// "Open Perry's WhatsApp": Ian finds the conversation by name (forgiving of
// voice-typing mistakes) or number and pops it open on screen. The screen
// action never reaches the AI (no full phone numbers to the model); unclear
// requests get a "which one?"; other admins' chats are never matched.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.WHATSAPP_PROVIDER = 'waha';

const assert = require('assert');
const wa = require('../core/whatsapp/store');
const leads = require('../core/leads/store');
const { openWhatsappChat } = require('../core/assistant/openChat');
const { invoke } = require('../core/assistant/handlers');
const { buildTools } = require('../core/assistant/tools');

const WS = 'aaaaaaaa-0000-0000-0000-0000000000a9';
const ME = { userId: 'admin-1', workspaceId: WS };
let n = 0;
const say = (number, name, text, userId = 'admin-1') => wa.saveMessage({
  provider: 'waha', sessionName: 'default', userId, workspaceId: WS, direction: 'in',
  contactNumber: number, contactName: name, text, waMessageId: `m-${++n}`,
});

(async () => {
  await say('233241110001', 'Perry', 'Hello, I need a website for my shop');
  await say('233241110002', 'Ama Bakery', 'Do you build online stores?');
  await say('233241110003', 'Kwame', 'Thanks!');
  await say('233241110004', 'Kwame A.', 'See you Monday');
  await say('233249999999', 'Perry Secret', 'not yours', 'admin-2'); // another admin's chat
  await leads.createLead(WS, { source: 'whatsapp', contact_number: '233241110001', name: 'Essandoh Perry' });

  // 1. The user's real requests, including voice-typing mistakes.
  for (const who of ['Essandoh Perry', 'Perry', 'perry', 'stand up Paris', "Essandoh's DM", 'Ama', 'ama bakery', '0001']) {
    const r = await openWhatsappChat({ who }, ME);
    assert.strictEqual(r.opened, true, `"${who}" should open a chat (${JSON.stringify(r)})`);
  }
  const perry = await openWhatsappChat({ who: 'stand up Paris' }, ME);
  assert.strictEqual(perry.ui.number, '233241110001');
  assert.strictEqual(perry.name, 'Essandoh Perry', 'uses the name Ian learned for the lead');
  assert(/website/.test(perry.last_message));
  console.log('✓ "Essandoh Perry", "Perry", "stand up Paris" (voice typing) and the last digits all open Perry\'s chat');

  // 2. Two people with a similar name: ask which one.
  const kwame = await openWhatsappChat({ who: 'Kwame' }, ME);
  assert.strictEqual(kwame.opened, false);
  assert.strictEqual(kwame.candidates.length, 2);
  assert(kwame.candidates.every((c) => /^\d{4}$/.test(c.number_ends)), 'only the last 4 digits');
  console.log('✓ two Kwames -> "which one?" (names + last 4 digits only)');

  // 3. No match: says so, with recent chats to choose from.
  const none = await openWhatsappChat({ who: 'Zebedee' }, ME);
  assert.strictEqual(none.ok, false);
  assert(/No WhatsApp chat matches/.test(none.error));
  assert(none.recent_chats.length >= 3);
  console.log('✓ no match -> says so and lists recent chats');

  // 4. Never another admin's chat.
  const secret = await openWhatsappChat({ who: 'Perry Secret' }, ME);
  assert.notStrictEqual(secret.ui?.number, '233249999999');
  const asOther = await openWhatsappChat({ who: 'Perry' }, { userId: 'admin-2', workspaceId: WS });
  assert.strictEqual(asOther.ui.number, '233249999999', "admin-2 only sees their own chat");
  console.log("✓ only your own WhatsApp chats are searched");

  // 5. Wired into Ian: the tool is offered, runs through invoke, and the screen action stays out of the AI's copy.
  assert(buildTools(null).some((t) => t.name === 'open_whatsapp_chat'));
  const viaIan = await invoke('open_whatsapp_chat', { who: 'Perry' }, ME);
  assert.strictEqual(viaIan.ui.action, 'open_whatsapp_chat');
  const index = require('fs').readFileSync(require.resolve('../core/assistant/index.js'), 'utf8');
  assert(/forModel\(result\)/.test(index), 'the AI gets the result without ui');
  console.log('✓ Ian has the tool; the "open this chat" action goes to your screen, not to the AI');

  console.log('\nAll open-chat tests passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
