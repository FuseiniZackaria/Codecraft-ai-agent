// Ian's WhatsApp voice and approval rules: no founder claim, no signature block
// by default, the voice-note reply, and approval-vs-FYI routing. Nothing real
// is sent: the AI, the send path and the owner alerts are all stubbed.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
process.env.WAHA_WEBHOOK_SECRET = 'test-webhook-secret';
delete process.env.WA_AUTO_REPLY; // default: auto-reply on for WAHA
delete process.env.WA_VOICE_FILE;

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const config = require('../config');
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const notifications = require('../core/notifications');
const voice = require('../core/whatsapp/voice');
const policy = require('../core/whatsapp/replyPolicy');
const waha = require('../core/whatsapp/WahaProvider');
const messaging = require('../core/whatsapp/messaging');
const store = require('../core/whatsapp/store');
const WhatsAppAgent = require('../agents/whatsapp/WhatsAppAgent');
const memory = require('../memory');

// ---- stubs ----
let modelAnswer = '';
let lastPrompt = null;
mockProvider.complete = async (req) => {
  lastPrompt = req;
  return { provider: 'mock', text: modelAnswer, costEstimate: 0 };
};

const sentToCustomer = []; // texts that went out through the approval-task path
orchestrator.approveTask = async (taskId) => {
  const task = await memory.getTask(taskId);
  sentToCustomer.push(task.payload.body);
  return { ...task, status: 'done' };
};
const fyi = [];
const pending = [];
notifications.notifyOwnerFyi = async (args) => { fyi.push(args); return 'sent'; };
notifications.notifyOwnerPendingApproval = async (args) => { pending.push(args); return {}; };
const attention = [];
notifications.notifyOwnerAttention = async (args) => { attention.push(args); return { telegram: 'sent' }; };

const wahaSends = [];
waha.sendMessage = async (session, to, text) => { wahaSends.push({ session, to, text }); return { id: `out-${wahaSends.length}` }; };
waha.sendTyping = async () => {};
messaging.timing.sleep = async () => {};

function reset() {
  sentToCustomer.length = 0;
  fyi.length = 0;
  pending.length = 0;
  wahaSends.length = 0;
  attention.length = 0;
}
const json = (reply, hold = false, reason = '') => JSON.stringify({ reply, hold, reason });

(async () => {
  const v = voice.loadVoice();
  const agent = new WhatsAppAgent();
  const ask = (body, extra = {}) => agent.handleIncomingMessage({ from: '233200000001', body, session: 'default', userId: 'admin-1', ...extra });

  // 1. The voice file is the one editable place, and it's read correctly
  {
    assert(v.instructions.includes('Ian from CodeCraft'), 'identity comes from the voice file');
    assert(v.instructions.includes('Zackman'), 'founder named in the voice file');
    assert(!/hold reply|voice note reply|signature/i.test(v.instructions.split('\n').filter((l) => /^[A-Z].*:$/.test(l)).join(' ')), 'fixed texts are not sent as instructions');
    assert.strictEqual(v.hold, 'Let me check with the team and get back to you shortly.');
    assert(!/voice notes? here yet|could you type/i.test(JSON.stringify(v)), 'no "please type it" text anywhere');
    assert.strictEqual(v.signature, '', 'no signature by default');

    // Edits are picked up without a restart
    const tmp = path.join(os.tmpdir(), `wa-voice-${crypto.randomUUID()}.md`);
    fs.writeFileSync(tmp, '## Tone\nBe brief.\n\n## Hold reply\nOne moment please.\n');
    process.env.WA_VOICE_FILE = tmp;
    assert.strictEqual(voice.loadVoice().hold, 'One moment please.');
    fs.writeFileSync(tmp, '## Tone\nBe brief.\n\n## Hold reply\nGive me a minute to check.\n');
    fs.utimesSync(tmp, new Date(), new Date(Date.now() + 5000));
    assert.strictEqual(voice.loadVoice().hold, 'Give me a minute to check.');
    assert.strictEqual(voice.loadVoice().signature, '', 'missing sections fall back to the defaults');
    delete process.env.WA_VOICE_FILE;
    fs.unlinkSync(tmp);
    console.log('✓ voice: tone rules and fixed replies come from config/whatsapp-voice.md and edits apply without a restart');
  }

  // 2. Ghana time-of-day greeting
  {
    assert.strictEqual(voice.ghanaTime(new Date('2026-11-05T08:30:00Z')).greeting, 'Good morning');
    assert.strictEqual(voice.ghanaTime(new Date('2026-11-05T14:00:00Z')).greeting, 'Good afternoon');
    assert.strictEqual(voice.ghanaTime(new Date('2026-11-05T19:45:00Z')).greeting, 'Good evening');
    reset();
    modelAnswer = json('Good morning! Message received loud and clear.');
    await ask('just testing', { from: '233200000099', now: new Date('2026-11-05T08:30:00Z') });
    assert(lastPrompt.system.includes('begin with "Good morning"'), 'greeting for the time in Ghana');
    assert(lastPrompt.system.includes('Akwaaba'), 'first-time contact');
    console.log('✓ greeting: by time of day in Ghana (Africa/Accra)');
  }

  // 3. No founder claim
  {
    assert(policy.identityProblem("Hi, I'm the founder of CodeCraft."));
    assert(policy.identityProblem('Good morning! My name is Kofi and I run things here.'));
    assert(policy.identityProblem('Good morning! Dumenu here, happy to help.', { ownerName: 'Dumenu Ian' }));
    assert.strictEqual(policy.identityProblem("Good morning! This is Ian from CodeCraft. I'm CodeCraft's assistant."), null);
    assert.strictEqual(policy.identityProblem('Zackman founded CodeCraft - I\'m Ian, his assistant.'), null);

    // The owner's name and email signature never reach the WhatsApp prompt
    const businessProfile = require('../core/businessProfile');
    const realGet = memory.getBusinessProfile;
    memory.getBusinessProfile = async () => ({ business_name: 'CodeCraft', display_name: 'Dumenu Ian', offers: 'AI agents', signature: 'Dumenu Ian\nFounder, CodeCraft' });
    businessProfile.invalidate();
    const chatLine = await businessProfile.profileContextLine('ws-1', { forChat: true });
    assert(!chatLine.includes('Dumenu') && !chatLine.includes('Founder'), 'no owner name or signature in the chat context');
    assert((await businessProfile.profileContextLine('ws-1')).includes('Dumenu'), 'other agents still see the owner');

    // A draft claiming to be the founder is never sent; the customer gets the holding reply
    reset();
    modelAnswer = json("Good morning! I'm Dumenu Ian, the founder of CodeCraft. How can I help?");
    const r = await ask('Hello, who am I speaking with?', { workspaceId: 'ws-1' });
    memory.getBusinessProfile = realGet;
    businessProfile.invalidate();
    assert.strictEqual(r.held, true);
    assert(/founder|Dumenu/.test(r.reason), r.reason);
    assert.deepStrictEqual(sentToCustomer, [v.hold], 'only the holding reply went out');
    assert(!sentToCustomer.join(' ').includes('founder'));
    console.log('✓ identity: Ian never claims to be the founder or uses the owner\'s name - such a draft is held');
  }

  // 4. No signature block by default
  {
    const signed = 'Good afternoon! Happy to help with that.\n\nBest regards,\nDumenu Ian\nCodeCraft | +233 20 000 0000';
    assert.strictEqual(policy.cleanReply(signed), 'Good afternoon! Happy to help with that.');
    assert.strictEqual(policy.cleanReply('Sure thing!\n- Ian'), 'Sure thing!');
    assert.strictEqual(policy.cleanReply('All the best with the lessons!\n\nDumenu Ian\nFounder, CodeCraft', { profileSignature: 'Dumenu Ian\nFounder, CodeCraft' }), 'All the best with the lessons!');
    assert.strictEqual(policy.cleanReply('"Ian: Thanks! Have a lovely day."'), 'Thanks! Have a lovely day.');
    assert.strictEqual(policy.cleanReply('Thanks for your message.'), 'Thanks for your message.', 'normal text untouched');
    assert.strictEqual(policy.cleanReply('Hi!', { signature: '- Ian, CodeCraft' }), 'Hi!\n\n- Ian, CodeCraft', 'a signature in the voice file is added on purpose');

    reset();
    modelAnswer = json('You\'re welcome! Have a lovely day.\n\nKind regards,\nCodeCraft Team');
    await ask('Thank you!');
    assert.deepStrictEqual(sentToCustomer, ["You're welcome! Have a lovely day."]);
    console.log('✓ signature: no sign-off or signature block on WhatsApp replies by default');
  }

  // 5. Voice notes, images and stickers
  {
    assert.strictEqual(waha.mediaKind({ hasMedia: true, _data: { type: 'ptt' } }), 'voice', 'WEBJS voice note');
    assert.strictEqual(waha.mediaKind({ hasMedia: true, _data: { Message: { audioMessage: { PTT: true } } } }), 'voice', 'GOWS voice note');
    assert.strictEqual(waha.mediaKind({ hasMedia: true, media: { mimetype: 'audio/ogg; codecs=opus' } }), 'voice');
    assert.strictEqual(waha.mediaKind({ hasMedia: true, _data: { Message: { stickerMessage: {} } } }), 'sticker');
    assert.strictEqual(waha.mediaKind({ hasMedia: true, media: { mimetype: 'image/jpeg' } }), 'image');
    assert.strictEqual(waha.mediaKind({ body: 'hello' }), null, 'text is not media');

    const raw = Buffer.from(JSON.stringify({ event: 'message', session: 'default', payload: { id: 'vn-1', from: '233200000002@c.us', fromMe: false, body: '', hasMedia: true, _data: { type: 'ptt' } } }));
    const event = waha.handleIncomingWebhook({ rawBody: raw, body: JSON.parse(raw), headers: { 'x-webhook-hmac': crypto.createHmac('sha512', 'test-webhook-secret').update(raw).digest('hex') } });
    assert.strictEqual(event.message.mediaType, 'voice');
    assert.strictEqual(event.message.text, '[voice note]', 'shown as [voice note] in the Inbox');

    reset();
    let routed = 0;
    const registry = require('../agents/registry');
    const realGetAgent = registry.getAgent;
    registry.getAgent = () => ({ handleIncomingMessage: async () => { routed += 1; } });
    const incoming = (id, mediaType, text, from = '233200000002') => messaging.handleIncomingMessage({
      providerName: 'waha', sessionName: 'default', userId: 'admin-1',
      message: { waMessageId: id, contactNumber: from, contactName: 'Ama', text, mediaType, timestamp: new Date().toISOString() },
    });
    const r1 = await incoming('vn-1', 'voice', '[voice note]');
    assert.strictEqual(r1.ownerAlerted, true);
    assert.deepStrictEqual(wahaSends, [], 'nothing is sent to the customer');
    assert.strictEqual(attention.length, 1, 'owner told to attend to this client');
    assert.strictEqual(attention[0].from, '233200000002');
    assert.strictEqual(attention[0].mediaType, 'voice');
    await incoming('vn-2', 'voice', '[voice note]');
    assert.strictEqual(attention.length, 1, 'a second voice note right after is not a second alert');
    assert.strictEqual(routed, 0, 'media alone never goes to the AI');

    for (const [id, kind] of [['st-1', 'sticker'], ['im-1', 'image']]) {
      await incoming(id, kind, `[${kind}]`, `2332000003${id === 'st-1' ? '01' : '02'}`);
    }
    assert.deepStrictEqual(attention.map((a) => a.mediaType), ['voice', 'sticker', 'image']);
    assert.deepStrictEqual(wahaSends, [], 'still nothing sent to customers');
    await incoming('im-2', 'image', 'Can you build a site like this one?');
    assert.strictEqual(routed, 1, 'an image WITH a caption is answered like a text message');

    // The owner's own number (e.g. answering an alert) never gets an AI reply
    config.notifications.ownerWhatsappNumber = '0202457446';
    const own = await incoming('own-1', null, 'ok I will call her', '233202457446');
    assert.strictEqual(own.reason, 'message from the owner');
    assert.strictEqual(routed, 1);
    config.notifications.ownerWhatsappNumber = null;
    registry.getAgent = realGetAgent;

    // Alert wording, and WhatsApp alerts work with WAHA (not just the Meta API)
    const realNotifs = require('../core/notifications');
    assert.strictEqual(typeof realNotifs.isChannelConfigured, 'function');
    config.notifications.ownerWhatsappNumber = '233202457446';
    const savedWaha = { ...config.waha };
    config.waha.baseUrl = 'http://waha.test'; config.waha.apiKey = 'k';
    assert.strictEqual(realNotifs.isChannelConfigured('whatsapp'), true, 'WAHA can deliver owner alerts');
    Object.assign(config.waha, savedWaha);
    config.notifications.ownerWhatsappNumber = null;
    console.log('✓ media: voice notes, stickers and images get NO reply - the owner is alerted to attend to the client (once)');
  }

  // 6. Approval vs FYI routing
  {
    // General question: answered straight away + Telegram FYI, nothing to approve
    reset();
    const teacher = 'Good morning! Great question. As a teacher, AI can help you prepare lesson notes, set and mark quizzes, and answer parents\' common questions on WhatsApp, saving you hours each week. What takes up most of your time right now?';
    modelAnswer = json(teacher);
    const r1 = await ask("How can I use AI in my business? I'm a teacher", { from: '233200000010' });
    assert.strictEqual(r1.held, false, r1.reason);
    assert.strictEqual(r1.autoSent, true);
    assert.deepStrictEqual(sentToCustomer, [teacher]);
    assert.strictEqual(fyi.length, 1, 'owner gets a Telegram FYI');
    assert.strictEqual(fyi[0].sentReply, teacher);
    assert.strictEqual(pending.length, 0, 'no approval needed');

    // "Cut costs" is a general question, not a pricing one
    reset();
    modelAnswer = json('Good afternoon! AI can take over routine replies and bookkeeping, which cuts a lot of costs. What kind of business do you run?');
    assert.strictEqual((await ask('Can AI help me cut costs in my shop?', { from: '233200000011' })).held, false);

    // Pricing: held even if the AI didn't flag it; customer told we'll check
    for (const [msg, why] of [
      ['How much do you charge for a website?', /pricing/],
      ['Okay, it\'s a deal. Let\'s go ahead with the chatbot.', /deal/],
      ['Can you finish it by Friday?', /deadline/],
      ['I\'m not happy with the work you did', /upset|complaint/],
      ['I want a refund', /complaint|sensitive/],
    ]) {
      reset();
      modelAnswer = json('Sure, no problem at all!');
      const r = await ask(msg, { from: `2332000001${String(Math.floor(Math.random() * 90) + 10)}` });
      assert.strictEqual(r.held, true, `"${msg}" should be held`);
      assert(why.test(r.reason), `"${msg}": ${r.reason}`);
      assert.deepStrictEqual(sentToCustomer, [v.hold], `"${msg}": only the holding reply goes out`);
      assert.strictEqual(pending.length, 1, 'owner asked to approve');
      assert.strictEqual(pending[0].draftReply, 'Sure, no problem at all!', 'the suggested answer waits for approval');
      assert.strictEqual(pending[0].customerToldText, v.hold);
      assert.strictEqual(fyi.length, 0, 'no FYI for held messages');
    }

    // The AI doesn't know: held
    reset();
    modelAnswer = json('I believe we can integrate with that system.', true, "don't know if we support that system");
    const r3 = await ask('Do you integrate with SAP Business One?', { from: '233200000030' });
    assert.strictEqual(r3.held, true);
    assert(/support that system/.test(r3.reason));

    // A price or a made-up link in the draft is held too
    reset();
    modelAnswer = json('A website starts at GH₵ 2,500.');
    assert.strictEqual((await ask('Tell me about your website service', { from: '233200000031' })).held, true);
    reset();
    modelAnswer = json('You can see our work at www.codecraft-demo.com.');
    assert(/link/.test((await ask('Do you have examples?', { from: '233200000032' })).reason));

    // An answer that isn't valid JSON fails closed
    reset();
    modelAnswer = 'Sure, here you go';
    assert.strictEqual((await ask('Hello there', { from: '233200000033' })).held, true);

    // The holding reply isn't repeated within 2 hours
    reset();
    await store.saveMessage({ provider: 'waha', sessionName: 'default', userId: 'admin-1', direction: 'out', contactNumber: '233200000040', text: v.hold, waMessageId: 'h-1', source: 'auto_reply' });
    modelAnswer = json('Sure!');
    const r4 = await ask('And how much for the logo?', { from: '233200000040' });
    assert.strictEqual(r4.held, true);
    assert.strictEqual(r4.holdSent, false);
    assert.deepStrictEqual(sentToCustomer, [], 'not told "let me check" twice');
    assert.strictEqual(pending.length, 1);

    // Auto-reply off: everything waits for approval, nothing is sent
    reset();
    config.whatsapp.autoReply = false;
    modelAnswer = json(teacher);
    const r5 = await ask("How can I use AI in my business? I'm a teacher", { from: '233200000050' });
    config.whatsapp.autoReply = true;
    assert.strictEqual(r5.autoSent, false);
    assert.deepStrictEqual(sentToCustomer, []);
    assert.strictEqual(pending.length, 1);
    console.log('✓ routing: general questions auto-reply with a Telegram FYI; pricing, deals, deadlines, complaints and unknowns wait for approval');
  }

  console.log('\nAll WhatsApp voice checks passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
