const composio = require('../../../core/composio');

module.exports = {
  name: 'postComment',
  permission: 'reddit.comment',
  irreversible: true, // public post, hard to undo -> approval gate applies

  async run({ thingId, text }) {
    if (!thingId || !text) {
      throw new Error('postComment requires "thingId" and "text"');
    }
    const result = await composio.execute('REDDIT_POST_REDDIT_COMMENT', { thing_id: thingId, text }, 'reddit');
    return { status: 'commented', thingId, ...result };
  },
};
