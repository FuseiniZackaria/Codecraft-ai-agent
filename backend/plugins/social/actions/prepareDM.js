/**
 * social.prepareDM - approval-only draft tool for social-platform DMs
 * (Instagram, Facebook, TikTok, X, LinkedIn, etc.). Produces a draft
 * approval card so the admin can see "To / Message / Platform" in the
 * standard Tasks UI. The approval button copies the message to the
 * admin's clipboard; it NEVER dispatches to a social platform's own API,
 * because those are a separate licensing + verification problem.
 *
 * Marked `irreversible` so BaseAgent.execute defers it through the same
 * approval gate every real send goes through - if a future upgrade wires
 * a real DM API, nothing about agent-side orchestration changes.
 *
 * If invoked at runtime (post-approval), this tool FAILS SAFE: it throws
 * a clear, structured error rather than silently succeeding, so a
 * misconfigured orchestrator can never claim a social DM was sent when
 * nothing in fact left this process.
 */
module.exports = {
  name: 'prepareDM',
  permission: 'social.send',
  irreversible: true,

  async run(_args, _context) {
    throw new Error(
      'social.prepareDM is approval-only - the admin copies the drafted message and sends it manually. ' +
      'No social-platform API is wired up. If you are seeing this at runtime, the orchestrator should not ' +
      'have called the tool; the approval card itself was the deliverable.'
    );
  },
};
