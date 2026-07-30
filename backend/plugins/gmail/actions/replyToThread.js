const composio = require('../../../core/composio');

module.exports = {
  name: 'replyToThread',
  permission: 'gmail.send',
  irreversible: true, // sending mail is user-facing and hard to undo -> approval gate applies

  async run({ threadId, body, recipientEmail }) {
    if (!threadId || !body || !recipientEmail) {
      throw new Error('replyToThread requires "threadId", "body", and "recipientEmail"');
    }

    // Composio auto-preserves the thread's original subject - passing a
    // custom subject here would start a new conversation instead of
    // threading, so it's intentionally not exposed as an argument.
    const result = await composio.execute('GMAIL_REPLY_TO_THREAD', {
      thread_id: threadId,
      message_body: body,
      recipient_email: recipientEmail,
    }, 'gmail');

    return { status: 'replied', threadId, ...result };
  },
};
