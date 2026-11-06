// Payment rule: the agent NEVER confirms a payment. "I've paid" / "sent the
// MoMo" / proof of payment, or a draft that says "payment received", always
// waits for a person; nothing is sent to the customer (you check and reply); the
// owner is alerted. Ordinary payment questions ("how do I pay?") still get
// normal answers. Nothing real is sent.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
delete process.env.WA_AUTO_REPLY;

const assert = require('assert');
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const notifications = require('../core/notifications');
const memory = require('../memory');
const policy = require('../core/whatsapp/replyPolicy');
const testChat = require('../core/knowledge/testChat');
const WhatsAppAgent = require('../agents/whatsapp/WhatsAppAgent');

const WS = 'aaaaaaaa-0000-0000-0000-0000000000ab';
let modelAnswer = '';
mockProvider.complete = async () => ({ provider: 'mock', text: modelAnswer, costEstimate: 0 });
const sent = [];
orchestrator.approveTask = async (taskId) => { const t = await memory.getTask(taskId); sent.push(t.payload.body); return { ...t, status: 'done' }; };
const pending = [];
notifications.notifyOwnerPendingApproval = async (a) => { pending.push(a); return {}; };
notifications.notifyOwnerFyi = async () => 'sent';
memory.getBusinessProfile = async () => ({ business_name: 'Ama Bakery' });

const agent = new WhatsAppAgent();
let n = 0;
const ask = (body) => agent.handleIncomingMessage({ from: `23320000${String(++n).padStart(4, '0')}`, body, workspaceId: WS, session: 'default', userId: 'admin-1' });
const answer = (reply) => JSON.stringify({ reply, hold: false, reason: '' });
const reset = () => { sent.length = 0; pending.length = 0; };

(async () => {
  // 1. What counts as "I've paid".
  {
    for (const t of ['I have paid', "I've sent the money", 'I just sent you the momo', 'payment done', 'here is the proof of payment',
      'transaction id 88412', 'please confirm my payment', 'have you received my money?', 'I made a transfer']) {
      assert(policy.isPaymentClaim(t), `should be a payment claim: ${t}`);
    }
    for (const t of ['I sent you a message yesterday', 'I sent you the details', 'how do I pay?', 'what payment methods do you accept?', 'Do you take momo?']) {
      assert(!policy.isPaymentClaim(t), `should NOT be a payment claim: ${t}`);
    }
    console.log('✓ "I\'ve paid / sent the MoMo / proof of payment" is recognised; payment questions are not');
  }

  // 2. A payment claim is never confirmed - even if the AI writes "received".
  {
    reset();
    modelAnswer = answer('Thank you, we have received your payment!');
    const r = await ask('Hi, I have sent the momo for the cake');
    assert.strictEqual(r.held, true);
    assert.strictEqual(r.reason, policy.PAYMENT_REASON);
    assert.deepStrictEqual(sent, [], 'nothing is sent - you check the money and reply');
    assert(!sent.join(' ').includes('received your payment'));
    assert.strictEqual(pending.length, 1, 'the owner is alerted');
    assert.strictEqual(pending[0].customerToldText, null);
    console.log('✓ "I have sent the MoMo" -> held; nothing is sent to the customer; you are alerted to check and reply');
  }

  // 3. Ian never says a payment arrived, whatever the customer wrote.
  {
    for (const d of ['Payment received, thanks!', 'Your payment has been confirmed.', 'Great - the money has reflected.']) {
      reset();
      modelAnswer = answer(d);
      const r = await ask('Thanks for your help');
      assert.strictEqual(r.held, true, d);
      assert(!sent.includes(d), `never sent: ${d}`);
    }
    console.log('✓ a reply saying "payment received / confirmed / reflected" is never sent');
  }

  // 4. Normal payment questions are still answered.
  {
    reset();
    modelAnswer = answer('We accept MoMo and bank transfer.');
    const r = await ask('What payment methods do you accept?');
    assert.strictEqual(r.held, false, r.reason);
    assert.deepStrictEqual(sent, ['We accept MoMo and bank transfer.']);
    console.log('✓ "what payment methods do you accept?" still gets a normal answer');
  }

  // 5. The Test chat shows the same payment message.
  {
    modelAnswer = answer('Payment received!');
    const { agent: reply } = await testChat.send(WS, 'I have paid, please check', { id: 'admin-1' });
    assert.strictEqual(reply.meta.held, true);
    assert.strictEqual(reply.meta.kind, 'payment');
    assert.strictEqual(reply.meta.customerSees, null);
    console.log('✓ the Test chat shows the payment is held with no reply sent');
  }

  console.log('All payment-rule checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
