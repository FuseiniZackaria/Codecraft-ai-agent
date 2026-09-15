const BaseAgent = require('../base/BaseAgent');
const config = require('../../config');
const activityLog = require('../../core/activityLog');
const { selectProvider } = require('../../core/router');
const { businessContextLine } = require('../../core/businessContext');
const { classifyReplySafety } = require('../../core/autoReplySafety');
const notifications = require('../../core/notifications');

/**
 * TelegramAgent - triggered by the webhook receiver on each incoming
 * message, not a user goal, so it skips the standard plan/execute loop.
 * Drafts a reply and spawns it as its own pending_approval task, same
 * safety pattern as every other channel - no unsupervised auto-send.
 *
 * If config.autoReply.telegram.enabled is on, a drafted reply ADDITIONALLY
 * gets run through classifyReplySafety() - only genuinely low-risk replies
 * (simple, factual, no sensitive keywords, under the length cap, within
 * the daily limit) get auto-approved through the exact same approveTask()
 * path a human click would use. Anything else - including this feature
 * being off entirely, the default - stays exactly as before: sitting in
 * the Tasks page waiting for a human.
 *
 * Whenever a message ends up NOT auto-sent, the owner gets pinged directly
 * (see core/notifications.js) so they don't have to keep checking the
 * Tasks page themselves to notice something's waiting.
 */
class TelegramAgent extends BaseAgent {
  constructor() {
    super({
      key: 'telegram',
      role: 'Telegram Agent',
      goals: ['Draft timely, on-brand replies to incoming Telegram messages for human approval'],
      tools: ['telegram.sendMessage'],
    });
  }

  async handleIncomingMessage({ from, body }) {
    const provider = selectProvider({});
    const result = await provider.complete({
      maxTokens: 400,
      system:
        `${businessContextLine()}You are drafting a Telegram reply to a customer message, in the ` +
        `business's voice - warm, brief, direct, not robotic. Respond with ONLY the reply text, ` +
        `nothing else - no quotes, no explanation.`,
      prompt: `Customer's message: "${body}"`,
    });

    const draft = result.text.trim();
    const approvalTask = await this.createApprovalTask({
      instruction: `Reply on Telegram to ${from}`,
      tool: 'telegram.sendMessage',
      payload: { to: from, body: draft },
    });

    let autoSent = false;
    if (config.autoReply.telegram.enabled) {
      const safety = await classifyReplySafety({ channel: 'telegram', incomingMessage: body, draftReply: draft });
      await activityLog.record(this.role, safety.safe ? 'auto_reply_approved' : 'auto_reply_blocked', from, {
        approvalTaskId: approvalTask.id,
        reason: safety.reason,
      });
      if (safety.safe) {
        // Lazy require - core/orchestrator requires agents/registry at its
        // own top level, and registry.js requires this file, a real
        // circular require (same issue already fixed in
        // core/outreachPipeline.js). Requiring it here instead of at the
        // top of this file defers evaluation until after the app has
        // fully started, once the cycle has already resolved.
        await require('../../core/orchestrator').approveTask(approvalTask.id);
        autoSent = true;
      }
    }

    if (!autoSent) {
      notifications
        .notifyOwnerPendingApproval({ channel: 'telegram', from, customerMessage: body, draftReply: draft, approvalTaskId: approvalTask.id })
        .catch((err) => console.warn(`[TelegramAgent] owner notification failed: ${err.message}`));
    }

    return draft;
  }
}

module.exports = TelegramAgent;