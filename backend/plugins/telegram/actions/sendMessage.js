const telegram = require('../../../core/telegramProvider');

module.exports = {
  name: 'sendMessage',
  permission: 'telegram.send',
  irreversible: true, // sending a message is user-facing and hard to undo -> approval gate applies

  async run({ to, body }) {
    if (!to || !body) {
      throw new Error('sendMessage requires "to" (the Telegram chat id) and "body"');
    }
    const result = await telegram.sendMessage(to, body);
    return { status: 'sent', to, ...result };
  },
};