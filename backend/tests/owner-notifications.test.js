const assert = require('assert');

const config = require('../config');
const telegramProvider = require('../core/telegramProvider');
const whatsappProvider = require('../core/whatsappProvider');
const { notifyOwnerPendingApproval, channelStatus, isChannelConfigured } = require('../core/notifications');
const toolRegistry = require('../tools/ToolRegistry');

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
  const originalApplicantEmail = config.applicant?.email;
  const originalTelegramBotToken = config.telegram?.botToken;
  const originalWhatsappAccess = config.whatsapp?.accessToken;
  const originalWhatsappPhone = config.whatsapp?.phoneNumberId;
  const originalGmailTool = toolRegistry.tools.get('gmail.sendEmail');

  // --- Case 1: no channel configured at all - clean no-op, 'not_configured' across the board, no errors ---
  config.notifications.ownerTelegramChatId = null;
  config.notifications.ownerWhatsappNumber = null;
  if (config.applicant) config.applicant.email = '';
  const result1 = await notifyOwnerPendingApproval({
    channel: 'telegram', from: 'chat-1', customerMessage: 'hi', draftReply: 'hello', approvalTaskId: 'task-1',
  });
  assert.strictEqual(result1.telegram, 'not_configured');
  assert.strictEqual(result1.whatsapp, 'not_configured');
  assert.strictEqual(result1.email, 'not_configured');
  console.log('✓ owner-notifications: no channel configured -> every channel reports not_configured, never a false "sent"');

  // --- Case 2: only Telegram configured and working - email fallback is NOT attempted ---
  config.notifications.ownerTelegramChatId = 'owner-chat-id';
  config.telegram.botToken = 'test-token';
  config.notifications.ownerWhatsappNumber = null;
  if (config.applicant) config.applicant.email = 'owner@example.com';

  let telegramCalledWith = null;
  let restoreTelegram = stubTelegramSend(async (to, text) => { telegramCalledWith = { to, text }; return { messageId: 1 }; });
  const result2 = await notifyOwnerPendingApproval({
    channel: 'telegram', from: 'customer-99', customerMessage: 'Do you deliver on weekends?', draftReply: 'Yes, Saturdays 10am-4pm!', approvalTaskId: 'task-2',
  });
  restoreTelegram();

  assert.strictEqual(result2.telegram, 'sent');
  assert.strictEqual(result2.whatsapp, 'not_configured');
  assert.strictEqual(result2.email, 'not_attempted',
    'with a chat channel delivering successfully, email fallback must not fire - avoids inbox noise');
  assert.strictEqual(telegramCalledWith.to, 'owner-chat-id');
  assert(telegramCalledWith.text.includes('customer-99'));
  console.log('✓ owner-notifications: chat succeeded -> email fallback stays silent, no false noise');

  // --- Case 3: both chat channels DOWN or missing, email fallback steps in ---
  config.notifications.ownerTelegramChatId = null;
  config.notifications.ownerWhatsappNumber = null;
  if (config.applicant) config.applicant.email = 'owner@example.com';

  let emailArgs = null;
  toolRegistry.tools.set('gmail.sendEmail', {
    permission: 'gmail.send',
    irreversible: true,
    run: async (args, ctx) => { emailArgs = { args, ctx }; return { status: 'sent' }; },
  });
  const result3 = await notifyOwnerPendingApproval({
    channel: 'whatsapp', from: 'customer-3', customerMessage: 'hi', draftReply: 'hello', approvalTaskId: 'task-3',
  });

  assert.strictEqual(result3.telegram, 'not_configured');
  assert.strictEqual(result3.whatsapp, 'not_configured');
  assert.strictEqual(result3.email, 'sent');
  assert.strictEqual(emailArgs.args.to, 'owner@example.com');
  assert(emailArgs.args.subject.startsWith('[CodeCraft/System]'),
    'email fallback must prefix [CodeCraft/System] so inbox triage filters recognize it');
  assert.strictEqual(emailArgs.ctx.systemDigest, true,
    'email fallback must route through the Gmail guard systemDigest path, not an arbitrary send');
  console.log('✓ owner-notifications: chat channels unavailable -> email fallback delivers to the owner, with [CodeCraft/System] subject and systemDigest context');

  // --- Case 4: WhatsApp and Telegram outages are REPORTED, not swallowed, and never crash ---
  config.notifications.ownerTelegramChatId = 'owner-chat-id';
  config.notifications.ownerWhatsappNumber = '+15551234567';
  config.whatsapp.accessToken = 'test-wa-token';
  restoreTelegram = stubTelegramSend(async () => { throw new Error('simulated telegram outage'); });
  const restoreWhatsapp = stubWhatsappSend(async () => { throw new Error('simulated whatsapp outage'); });

  const result4 = await notifyOwnerPendingApproval({
    channel: 'telegram', from: 'customer-4', customerMessage: 'hi', draftReply: 'hello', approvalTaskId: 'task-4',
  });
  restoreTelegram(); restoreWhatsapp();

  assert(result4.telegram.startsWith('failed:'));
  assert(result4.whatsapp.startsWith('failed:'));
  assert.strictEqual(result4.email, 'sent',
    'both chat channels failing -> email fallback kicks in rather than silently losing the alert');
  console.log('✓ owner-notifications: chat failures are surfaced and the email fallback picks up the alert, never dropped silently');

  // --- Case 5: isChannelConfigured / channelStatus reflect reality ---
  config.notifications.ownerTelegramChatId = null;
  config.notifications.ownerWhatsappNumber = null;
  config.telegram.botToken = null;
  config.whatsapp.accessToken = null;
  config.whatsapp.phoneNumberId = null;
  if (config.applicant) config.applicant.email = 'owner@example.com';
  const status = channelStatus();
  assert.strictEqual(status.telegram, 'not_configured');
  assert.strictEqual(status.whatsapp, 'not_configured');
  assert.strictEqual(status.email, 'configured');
  assert.strictEqual(isChannelConfigured('telegram'), false);
  assert.strictEqual(isChannelConfigured('whatsapp'), false);
  assert.strictEqual(isChannelConfigured('email'), true);
  console.log('✓ owner-notifications: channelStatus / isChannelConfigured honestly report WhatsApp and Telegram as unconfigured when they are');

  // --- Restore everything the test touched. ---
  config.notifications.ownerTelegramChatId = originalTelegramChatId;
  config.notifications.ownerWhatsappNumber = originalWhatsappNumber;
  if (config.applicant) config.applicant.email = originalApplicantEmail;
  config.telegram.botToken = originalTelegramBotToken;
  config.whatsapp.accessToken = originalWhatsappAccess;
  config.whatsapp.phoneNumberId = originalWhatsappPhone;
  if (originalGmailTool) toolRegistry.tools.set('gmail.sendEmail', originalGmailTool);
  else toolRegistry.tools.delete('gmail.sendEmail');

  console.log('\nAll owner notification checks passed.');
}

main().catch((err) => {
  console.error('✗ owner-notifications.test.js failed:', err);
  process.exit(1);
});
