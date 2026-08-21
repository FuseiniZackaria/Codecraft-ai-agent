const whatsapp = require('../../../core/whatsappProvider');

module.exports = {
  name: 'sendMessage',
  permission: 'whatsapp.send',
  irreversible: true, // sending a message is user-facing and hard to undo -> approval gate applies

  async run({ to, body }) {
    if (!to || !body) {
      throw new Error('sendMessage requires "to" (phone number) and "body"');
    }

    // WhatsApp Business API only delivers free-form messages to numbers that
    // have messaged the business within the last 24 hours - outside that
    // window this will fail unless a pre-approved template is used instead.
    const result = await whatsapp.sendMessage(to, body);
    return { status: 'sent', to, ...result };
  },
};
