const composio = require('../../../core/composio');

module.exports = {
  name: 'readInbox',
  permission: 'gmail.read',
  irreversible: false,

  async run({ limit = 5, query } = {}, context = {}) {
    const result = await composio.execute('GMAIL_FETCH_EMAILS', {
      max_results: limit,
      ...(query ? { query } : {}),
    }, 'gmail', { workspaceId: context.workspaceId });

    return result;
  },
};
