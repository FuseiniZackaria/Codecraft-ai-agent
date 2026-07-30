const composio = require('../../../core/composio');

module.exports = {
  name: 'sendEmail',
  permission: 'gmail.send',
  irreversible: true, // sending mail is user-facing and hard to undo -> approval gate applies

  async run({ to, subject, body }) {
    const missing = [];
    if (!to) missing.push('to');
    if (!subject) missing.push('subject');
    if (missing.length) {
      throw new Error(`sendEmail is missing: ${missing.join(', ')}`);
    }

    // Throws a clear error (via core/composio.js) if COMPOSIO_API_KEY is missing
    // or Gmail isn't connected for this Composio user - no silent mock fallback.
    const result = await composio.execute('GMAIL_SEND_EMAIL', {
      recipient_email: to,
      subject,
      body: body || '',
    }, 'gmail');

    return { status: 'sent', to, subject, ...result };
  },
};
