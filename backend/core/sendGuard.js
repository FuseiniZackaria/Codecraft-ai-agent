/**
 * sendGuard - last-line safety that stops a test run from accidentally
 * posting, uploading, or messaging a real recipient.
 *
 * This is NOT the primary send protection - that's still the approval
 * flow (Gmail guard, orchestrator pending_approval tasks, outreach mode
 * = 'manual' by default, auto-reply defaults = off). sendGuard is one
 * more belt around the braces, specifically for the test runners:
 *
 *   - The default `npm test` runner blanks every send-related env var
 *     and sets CC_TESTING=1. If a test accidentally reaches a real send
 *     function, it fails fast with a clear message instead of silently
 *     making a call that happens to no-op because the key is missing.
 *
 *   - `npm run test:integration` keeps real keys but still sets
 *     CC_TESTING=1. Send paths that reach this guard require the
 *     explicit ALLOW_REAL_SENDS=1 opt-in to proceed. Without it, every
 *     real-send attempt throws with the channel name - so the user has
 *     to deliberately turn on real sends and acknowledge the risk.
 *
 * Non-test runtime (the running server) never sets CC_TESTING, so this
 * guard is a no-op in production.
 */

const SEND_ACTION_SLUGS = new Set([
  // Gmail
  'GMAIL_SEND_EMAIL',
  'GMAIL_REPLY_TO_THREAD',
  'GMAIL_SEND_DRAFT',
  // YouTube
  'YOUTUBE_MULTIPART_UPLOAD_VIDEO',
  'YOUTUBE_POST_COMMENT_ON_VIDEO',
  'YOUTUBE_INSERT_COMMENT_THREAD',
  'YOUTUBE_INSERT_COMMENT',
  // Reddit
  'REDDIT_POST_COMMENT',
  'REDDIT_SUBMIT_POST',
  'REDDIT_SEND_PRIVATE_MESSAGE',
  // GitHub (write operations)
  'GITHUB_CREATE_REPOSITORY',
  'GITHUB_CREATE_ISSUE',
  'GITHUB_CREATE_PULL_REQUEST',
  'GITHUB_ADD_ISSUE_COMMENT',
  'GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS',
  // Slack
  'SLACK_POSTMESSAGE',
  'SLACK_SEND_MESSAGE',
]);

function isSendActionSlug(actionSlug) {
  if (!actionSlug) return false;
  if (SEND_ACTION_SLUGS.has(actionSlug)) return true;
  // Pattern-match write-shaped verbs for Composio actions we haven't
  // enumerated explicitly - better to over-block in tests than let a
  // novel SEND_* slug slip through.
  return /^[A-Z]+_(SEND|POST|REPLY|UPLOAD|SUBMIT|CREATE|DELETE|UPDATE|REMOVE)_/.test(actionSlug);
}

class SendGuardError extends Error {
  constructor(channel, extra = {}) {
    super(
      `[sendGuard] Real send to ${channel} refused: CC_TESTING is set and ALLOW_REAL_SENDS is not. ` +
      `This is a test-mode safety guard - either run with ALLOW_REAL_SENDS=1 to explicitly opt in, ` +
      `or stub the send function in the test before invoking the agent/tool.`
    );
    this.code = 'SEND_GUARD_BLOCKED';
    this.channel = channel;
    Object.assign(this, extra);
  }
}

/**
 * Throws if we're in test mode and real sends haven't been explicitly
 * allowed. Call this at the FIRST line of any function that would make
 * an outbound send/post/upload against a real recipient.
 *
 * @param {string} channel - human-readable channel name for the error
 *   (e.g. "WhatsApp (Twilio)", "Gmail", "YouTube upload")
 */
function assertRealSendsAllowed(channel) {
  if (process.env.CC_TESTING !== '1') return; // not a test run - no-op
  if (process.env.ALLOW_REAL_SENDS === '1') return; // explicit opt-in
  throw new SendGuardError(channel);
}

/**
 * Convenience for the composio.execute path - the single call site handles
 * every action slug, so this helper narrows the guard to just the ones
 * that actually send/upload/post, letting read-only calls pass through
 * untouched. Returns true if the call should proceed, throws otherwise.
 */
function assertComposioActionAllowed(actionSlug) {
  if (!isSendActionSlug(actionSlug)) return; // read-only - no guard needed
  assertRealSendsAllowed(`Composio action ${actionSlug}`);
}

module.exports = {
  assertRealSendsAllowed,
  assertComposioActionAllowed,
  isSendActionSlug,
  SendGuardError,
  SEND_ACTION_SLUGS,
};
