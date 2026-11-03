const BaseAgent = require('../base/BaseAgent');
const config = require('../../config');
const activityLog = require('../../core/activityLog');
const { selectProvider } = require('../../core/router');
const { businessContextLine } = require('../../core/businessContext');
const { classifyReplySafety } = require('../../core/autoReplySafety');
const notifications = require('../../core/notifications');

/**
 * WhatsAppAgent - triggered by the webhook receiver on each incoming
 * customer message, not a user goal, so it skips the standard plan/execute
 * loop. Drafts a reply and spawns it as its own pending_approval task,
 * same safety pattern as every other channel - no unsupervised auto-send.
 *
 * If auto-reply is on, a drafted reply ADDITIONALLY gets run through
 * classifyReplySafety() - only genuinely low-risk replies get auto-approved
 * through the exact same approveTask() path a human click would use. For
 * WAHA (a linked phone) auto-reply is on by default (WA_AUTO_REPLY); for
 * Twilio/Meta it stays opt-in (WHATSAPP_AUTO_REPLY_ENABLED).
 *
 * Whenever a message ends up NOT auto-sent, the owner gets pinged directly
 * (see core/notifications.js) so they don't have to keep checking the
 * Tasks page themselves to notice something's waiting.
 */
class WhatsAppAgent extends BaseAgent {
  constructor() {
    super({
      key: 'whatsapp',
      role: 'WhatsApp Agent',
      goals: ['Draft timely, on-brand replies to incoming customer messages for human approval'],
      tools: ['whatsapp.sendMessage'],
    });
  }

  /**
   * @param {object} msg
   * @param {string} msg.from - customer's number
   * @param {string} msg.body - their message
   * @param {string} [msg.workspaceId]
   * @param {string} [msg.session] - WAHA session it arrived on; the reply goes out from the same one
   */
  async handleIncomingMessage({ from, body, workspaceId: wsFromWebhook, session = null }) {
    const workspaceId = wsFromWebhook || null;

    const provider = selectProvider({});
    const businessLine = await businessContextLine(workspaceId);
    const result = await provider.complete({
      maxTokens: 400,
      system:
        `${businessLine}You are drafting a WhatsApp reply to a customer message, in the ` +
        `business's voice - warm, brief, direct, not robotic. Respond with ONLY the reply text, ` +
        `nothing else - no quotes, no explanation.`,
      prompt: `Customer's message: "${body}"`,
    });

    const draft = result.text.trim();
    const approvalTask = await this.createApprovalTask({
      instruction: `Reply on WhatsApp to ${from}`,
      tool: 'whatsapp.sendMessage',
      payload: session ? { to: from, body: draft, session } : { to: from, body: draft },
      workspaceId,
    });

    // WAHA (a linked phone): replies auto-send by default (WA_AUTO_REPLY=false turns it off).
    // Twilio/Meta: the original opt-in (WHATSAPP_AUTO_REPLY_ENABLED). Either way the
    // safety check below decides; anything it doesn't pass waits for approval.
    const autoReplyOn = session ? config.whatsapp.autoReply : config.autoReply.whatsapp.enabled;
    let autoSent = false;
    if (autoReplyOn) {
      const safety = await classifyReplySafety({ channel: 'whatsapp', incomingMessage: body, draftReply: draft, workspaceId });
      await activityLog.record(this.role, safety.safe ? 'auto_reply_approved' : 'auto_reply_blocked', from, {
        approvalTaskId: approvalTask.id,
        reason: safety.reason,
        workspaceId,
      });
      if (safety.safe) {
        // Lazy require - see TelegramAgent.js for why (circular dependency
        // via core/orchestrator -> agents/registry -> this file).
        await require('../../core/orchestrator').approveTask(approvalTask.id, { workspaceId });
        autoSent = true;
      }
    }

    if (!autoSent) {
      notifications
        .notifyOwnerPendingApproval({ channel: 'whatsapp', from, customerMessage: body, draftReply: draft, approvalTaskId: approvalTask.id, workspaceId })
        .catch((err) => console.warn(`[WhatsAppAgent] owner notification failed: ${err.message}`));
    }

    return draft;
  }
}

module.exports = WhatsAppAgent;