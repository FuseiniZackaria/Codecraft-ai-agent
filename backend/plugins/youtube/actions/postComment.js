const composio = require('../../../core/composio');

// IMPORTANT, please read before relying on this action:
// This tool slug is a best-evidenced guess, NOT verified against a live
// Composio account (no credentials were available to confirm it directly).
// The guess is based on this codebase's own confirmed working pattern for
// Reddit (REDDIT_POST_REDDIT_COMMENT - notably NOT the more obvious
// "REDDIT_POST_COMMENT"), which closely mirrors Composio's dashboard
// display name in SCREAMING_SNAKE_CASE. Composio's YouTube toolkit lists a
// tool labeled "Post Comment on Video", so following the same pattern gives
// YOUTUBE_POST_COMMENT_ON_VIDEO. If this is wrong, composio.execute() will
// throw a clear error (often naming the correct slug or confirming this one
// doesn't exist) - a one-line fix once you see that error for real.
const ACTION_SLUG = 'YOUTUBE_POST_COMMENT_ON_VIDEO';

module.exports = {
  name: 'postComment',
  permission: 'youtube.comment',
  irreversible: true, // a public comment on someone else's video, hard to undo -> approval gate applies

  async run({ videoId, text }) {
    if (!videoId || !text) {
      throw new Error('postComment requires "videoId" and "text"');
    }
    const result = await composio.execute(ACTION_SLUG, { videoId, text }, 'youtube');
    return { status: 'commented', videoId, ...result };
  },
};
