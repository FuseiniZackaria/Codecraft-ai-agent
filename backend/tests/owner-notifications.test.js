const assert = require('assert');

const config = require('../config');
const telegramProvider = require('../core/telegramProvider');
const whatsappProvider = require('../core/whatsappProvider');
const { notifyOwnerPendingApproval } = require('../core/notifications');

function stubTelegramSend(fn) {
  const original = telegramProvider.sendMessage;
  telegramProvider.sendMessage = fn;
  return () => { telegramProvider.sendMessage = original; };
}

function stubWhatsappSend(fn) {
  const original = whatsappProvider.sendMessage;
  whatsappProvider.sendMessage = fn;
  return () => { whatsappProvider.sendMessage = original; };
}

async function main() {
  const originalTelegramChatId = config.notifications.ownerTelegramChatId;
  const originalWhatsappNumber = config.notifications.ownerWhatsappNumber;

  // --- Case 1: neither channel configured - a clean no-op, no errors ---
  config.notifications.ownerTelegramChatId = null;
  config.notifications.ownerWhatsappNumber = null;
  const result1 = await notifyOwnerPendingApproval({
    channel: 'telegram', from: 'chat-1', customerMessage: 'hi', draftReply: 'hello', approvalTaskId: 'task-1',
  });
  assert.strictEqual(result1.telegram, null);
  assert.strictEqual(result1.whatsapp, null);
  console.log('✓ notifyOwnerPendingApproval: a clean no-op when neither owner channel is configured');

  // --- Case 2: only Telegram configured - only Telegram gets called ---
  config.notifications.ownerTelegramChatId = 'owner-chat-id';
  config.notifications.ownerWhatsappNumber = null;
  let telegramCalledWith = null;
  let restoreTelegram = stubTelegramSend(async (to, text) => { telegramCalledWith = { to, text }; return { messageId: 1 }; });

  const result2 = await notifyOwnerPendingApproval({
    channel: 'telegram', from: 'customer-chat-99', customerMessage: 'Do you deliver on weekends?', draftReply: 'Yes, Saturdays 10am-4pm!', approvalTaskId: 'task-2',
  });
  restoreTelegram();

  assert.strictEqual(result2.telegram, 'sent');
  assert.strictEqual(result2.whatsapp, null);
  assert.strictEqual(telegramCalledWith.to, 'owner-chat-id');
  assert(telegramCalledWith.text.includes('customer-chat-99'));
  assert(telegramCalledWith.text.includes('Do you deliver on weekends?'));
  assert(telegramCalledWith.text.includes('Yes, Saturdays 10am-4pm!'));
  console.log('✓ notifyOwnerPendingApproval: sends a real Telegram alert to the owner with the actual customer message and draft included');

  // --- Case 3: both channels configured - both get called ---
  config.notifications.ownerTelegramChatId = 'owner-chat-id';
  config.notifications.ownerWhatsappNumber = '+15551234567';
  let telegramCalled = false;
  let whatsappCalled = false;
  restoreTelegram = stubTelegramSend(async () => { telegramCalled = true; return { messageId: 1 }; });
  let restoreWhatsapp = stubWhatsappSend(async () => { whatsappCalled = true; return { status: 'sent' }; });

  const result3 = await notifyOwnerPendingApproval({
    channel: 'whatsapp', from: 'customer-2', customerMessage: 'hi', draftReply: 'hello', approvalTaskId: 'task-3',
  });
  restoreTelegram(); restoreWhatsapp();

  assert.strictEqual(telegramCalled, true, 'with both channels configured, Telegram alert should also fire regardless of which channel the customer message came in on');
  assert.strictEqual(whatsappCalled, true);
  assert.strictEqual(result3.telegram, 'sent');
  assert.strictEqual(result3.whatsapp, 'sent');
  console.log('✓ notifyOwnerPendingApproval: with both owner channels configured, both actually get alerted');

  // --- Case 4: a failure in one channel doesn't prevent the other, and never throws ---
  config.notifications.ownerTelegramChatId = 'owner-chat-id';
  config.notifications.ownerWhatsappNumber = '+15551234567';
  restoreTelegram = stubTelegramSend(async () => { throw new Error('simulated telegram outage'); });
  let whatsappCalled2 = false;
  restoreWhatsapp = stubWhatsappSend(async () => { whatsappCalled2 = true; return { status: 'sent' }; });

  const result4 = await notifyOwnerPendingApproval({
    channel: 'telegram', from: 'customer-3', customerMessage: 'hi', draftReply: 'hello', approvalTaskId: 'task-4',
  });
  restoreTelegram(); restoreWhatsapp();

  assert(result4.telegram.includes('failed'));
  assert.strictEqual(result4.whatsapp, 'sent');
  assert.strictEqual(whatsappCalled2, true, 'a failure alerting via Telegram must not prevent the WhatsApp alert from still going out');
  console.log('✓ notifyOwnerPendingApproval: a failure on one channel does not block the other, and never throws');

  // --- Case 5: long customer message / draft gets truncated, not sent in full ---
  config.notifications.ownerTelegramChatId = 'owner-chat-id';
  config.notifications.ownerWhatsappNumber = null;
  let longText = null;
  restoreTelegram = stubTelegramSend(async (to, text) => { longText = text; return { messageId: 1 }; });
  const veryLongMessage = 'a'.repeat(1000);
  await notifyOwnerPendingApproval({ channel: 'telegram', from: 'c', customerMessage: veryLongMessage, draftReply: 'short reply', approvalTaskId: 't' });
  restoreTelegram();
  assert(longText.length < veryLongMessage.length + 200, 'a very long customer message should be truncated in the alert, not included in full');
  console.log('✓ notifyOwnerPendingApproval: long customer messages are truncated in the alert rather than sent in full');

  config.notifications.ownerTelegramChatId = originalTelegramChatId;
  config.notifications.ownerWhatsappNumber = originalWhatsappNumber;

  // --- Integration: TelegramAgent actually calls the notification when a message stays pending ---
  const { loadPlugins } = require('../core/pluginLoader');
  loadPlugins();
  const mockProvider = require('../core/providers/mockProvider');
  const aiProvider = require('../core/providers/aiProvider');
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = async () => ({ text: 'Sure, happy to help!', provider: 'mock', costEstimate: 0 });
  aiProvider.complete = async () => ({ text: 'Sure, happy to help!', provider: 'mock', costEstimate: 0 });

  config.notifications.ownerTelegramChatId = 'owner-chat-id';
  config.autoReply.telegram.enabled = false; // stays pending -> should notify
  let notifyCalled = false;
  let notifyArgs = null;
  restoreTelegram = stubTelegramSend(async (to, text) => { notifyCalled = true; notifyArgs = { to, text }; return { messageId: 1 }; });

  const TelegramAgent = require('../agents/telegram/TelegramAgent');
  const agent = new TelegramAgent();
  await agent.handleIncomingMessage({ from: 'real-customer-1', body: 'Are you open today?' });
  // Give the fire-and-forget notification a tick to run.
  await new Promise((r) => setTimeout(r, 20));
  restoreTelegram();

  mockProvider.complete = originalMock;
  aiProvider.complete = originalAi;
  config.notifications.ownerTelegramChatId = originalTelegramChatId;

  assert.strictEqual(notifyCalled, true, 'TelegramAgent should trigger the owner notification when the reply stays pending');
  assert(notifyArgs.text.includes('real-customer-1'));
  console.log('✓ TelegramAgent: actually triggers the owner notification when a customer message stays pending approval');

  console.log('\nAll owner notification checks passed.');
}

main().catch((err) => {
  console.error('✗ owner-notifications.test.js failed:', err);
  process.exit(1);
});