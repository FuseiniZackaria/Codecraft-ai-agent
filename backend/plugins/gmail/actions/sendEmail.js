const composio = require('../../../core/composio');
const guard = require('../guard');

module.exports = {
  name: 'sendEmail',
  permission: 'gmail.send',
  irreversible: true, // sending mail is user-facing and hard to undo -> approval gate applies

  // The second argument is the ToolRegistry call context. orchestrator.approveTask
  // passes { role, approvedTaskId } here; direct internal callers (e.g. the
  // Sales manual-apply digest) MUST pass { systemDigest: true, role } and the
  // guard will refuse anything that isn't the configured owner email.
  async run({ to, subject, body }, context = {}) {
    const missing = [];
    if (!to) missing.push('to');
    if (!subject) missing.push('subject');
    if (missing.length) {
      throw new Error(`sendEmail is missing: ${missing.join(', ')}`);
    }

    // Guard rejects anything that bypasses the approval gate OR tampers with
    // the approved recipient/payload OR duplicates a recent send.
    const verdict = await guard.guardSend({ to, subject, body }, context);

    // Throws clearly (via core/composio.js) if COMPOSIO_API_KEY is missing or
    // Gmail isn't connected for this Composio user - no silent mock fallback.
    const result = await composio.execute('GMAIL_SEND_EMAIL', {
      recipient_email: to,
      subject,
      body: body || '',
    }, 'gmail');

    // Register / update the outreach_threads row so later replies in this
    // thread pass the ownership check. threadId / messageId come back from
    // Composio when the Gmail API returns them.
    const threadId = result?.data?.threadId || result?.threadId || null;
    const messageId = result?.data?.id || result?.messageId || null;
    if (threadId && verdict?.task) {
      await guard.recordSentThread({
        approvedTaskId: verdict.task.id,
        threadId,
        recipientEmail: to,
        messageId,
        agentKey: verdict.task.agent,
        campaign: verdict.task.payload?.campaign || null,
        companyName: verdict.task.payload?.companyName || null,
      });
    }

    return { status: 'sent', to, subject, threadId, ...result };
  },
};
