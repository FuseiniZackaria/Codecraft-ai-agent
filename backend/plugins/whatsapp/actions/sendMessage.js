const config = require('../../../config');
const whatsapp = require('../../../core/whatsappProvider');

module.exports = {
  name: 'sendMessage',
  permission: 'whatsapp.send',
  irreversible: true, // sending a message is user-facing and hard to undo -> approval gate applies

  /**
   * @param {{to: string, body: string, session?: string, outreach?: boolean, typing?: boolean, source?: string, image?: {url: string}, linkPreview?: boolean}} args
   *   image:       send a photo (WAHA only); body becomes its caption
   *   linkPreview: show a preview for a link in the text (WAHA only)
   *   session:  the WAHA session to send from (set on replies to incoming messages)
   *   outreach: a cold/outreach message (Sales agent) - with WAHA it goes through the
   *             paced outreach queue (30-90s gaps, daily cap, skips "stop") instead of sending now
   * @param {{workspaceId?: string}} context
   */
  async run({ to, body, session, outreach, typing, source, image, linkPreview }, context = {}) {
    if (!to || !body) {
      throw new Error('sendMessage requires "to" (phone number) and "body"');
    }

    if (outreach && config.whatsapp.provider === 'waha') {
      const store = require('../../../core/whatsapp/store');
      const sessions = await store.listWorkingSessions(context.workspaceId || null);
      if (!sessions.length) throw new Error('No WhatsApp account is linked in this workspace - connect WhatsApp on the Connections page first.');
      const s = sessions[0];
      const result = await require('../../../core/whatsapp/outbox').enqueue({
        sessionName: s.session_name, userId: s.user_id, workspaceId: s.workspace_id, recipients: [{ number: to, text: body }],
      });
      if (!result.queued) throw new Error(result.rejected[0]?.reason || 'Could not queue the message');
      return { status: 'queued', to, note: 'Queued for paced WhatsApp outreach (30-90s apart, daily limit applies).' };
    }

    // Twilio/Meta: free-form messages only deliver to numbers that messaged the
    // business in the last 24 hours. WAHA (a linked phone) has no such window.
    const result = await whatsapp.sendMessage(to, body, {
      session,
      workspaceId: context.workspaceId || null,
      typing: typing !== undefined ? !!typing : !!session, // replies show "typing..." first
      source: source || (session ? 'auto_reply' : 'agent'),
      image: image || null,
      linkPreview: !!linkPreview,
    });
    return { status: 'sent', to, ...result };
  },
};
