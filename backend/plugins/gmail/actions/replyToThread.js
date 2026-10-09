const composio = require('../../../core/composio');
const guard = require('../guard');

module.exports = {
  name: 'replyToThread',
  permission: 'gmail.send',
  irreversible: true, // sending mail is user-facing and hard to undo -> approval gate applies

  // Second argument is the ToolRegistry call context (see sendEmail.js for the
  // reasoning). orchestrator.approveTask supplies { role, approvedTaskId }.
  async run({ threadId, body, recipientEmail }, context = {}) {
    if (!threadId || !body || !recipientEmail) {
      throw new Error('replyToThread requires "threadId", "body", and "recipientEmail"');
    }

    // Guard rejects anything that bypasses approval, replies to a thread
    // owned by a different agent, replies to a tampered recipient, or
    // duplicates a recent reply.
    const verdict = await guard.guardReply({ threadId, body, recipientEmail }, context);

    // Composio auto-preserves the thread's original subject - passing a
    // custom subject here would start a new conversation instead of
    // threading, so it's intentionally not exposed as an argument.
    const result = await composio.execute('GMAIL_REPLY_TO_THREAD', {
      thread_id: threadId,
      message_body: body,
      recipient_email: recipientEmail,
    }, 'gmail');

    // Keep the outreach_threads row warm: last_message_id, status flip to
    // whichever makes sense (sent). Does nothing if the thread isn't
    // registered.
    const messageId = result?.data?.id || result?.messageId || null;
    if (verdict?.outreachThread) {
      try {
        const memory = require('../../../memory');
        await memory.updateOutreachThread(verdict.outreachThread.id, {
          lastMessageId: messageId || verdict.outreachThread.lastMessageId || null,
          outreachStatus: 'sent',
          approvedTaskId: verdict.task?.id || verdict.outreachThread.approvedTaskId || null,
        });
      } catch {
        // Non-fatal.
      }
    }

    return { status: 'replied', threadId, ...result };
  },
};
