const BaseAgent = require('../base/BaseAgent');
const config = require('../../config');
const activityLog = require('../../core/activityLog');
const { selectProvider } = require('../../core/router');
const { businessContextLine } = require('../../core/businessContext');
const businessProfile = require('../../core/businessProfile');
const { countSentToday } = require('../../core/autoReplySafety');
const notifications = require('../../core/notifications');
const voice = require('../../core/whatsapp/voice');
const agentSettings = require('../../core/knowledge/agentSettings');
const retrieval = require('../../core/knowledge/retrieval');
const replyPolicy = require('../../core/whatsapp/replyPolicy');

/**
 * WhatsAppAgent - triggered by the webhook receiver on each incoming customer
 * message, not a user goal, so it skips the standard plan/execute loop.
 *
 * How it speaks - its name, instructions, example replies and the "team will
 * follow up" message - is set per workspace on Settings -> General -> Agent
 * instructions (core/knowledge/agentSettings.js), and applies on the next reply.
 *
 * With auto-reply on (WAHA: WA_AUTO_REPLY, default on; Twilio/Meta:
 * WHATSAPP_AUTO_REPLY_ENABLED):
 *   - general questions and enquiries are answered straight away, and the
 *     owner gets a Telegram FYI (nothing to approve);
 *   - pricing/quotes, deals, deadlines/promises, complaints or anything Ian
 *     doesn't know are HELD: the customer gets the "let me check with the
 *     team" reply, Ian's suggested answer waits on the Tasks page, and the
 *     owner is alerted (core/notifications.js).
 * With auto-reply off, every reply waits for approval, as before.
 *
 * Every send - automatic or approved - goes through the same approval-task
 * path (createApprovalTask + approveTask), so it's all in the audit trail.
 */

const TOOL = 'whatsapp.sendMessage';
const GREETING_GAP_MS = 6 * 60 * 60 * 1000; // no message from Ian for 6h = a new conversation, greet again
const HOLD_REPEAT_MS = 2 * 60 * 60 * 1000; // don't repeat "let me check with the team" within 2h

const OUTPUT_FORMAT =
  'Answer with ONLY a JSON object, nothing else:\n' +
  '{"reply": "<your WhatsApp message to the customer>", "hold": <true or false>, "reason": "<if hold: why, in a few words; else empty>"}\n' +
  'If hold is true, "reply" is your suggested answer for the team to check before it is sent.';

/** Stored messages keep their text in `body`. */
const msgText = (m) => String(m.body ?? m.text ?? '');

class WhatsAppAgent extends BaseAgent {
  constructor() {
    super({
      key: 'whatsapp',
      role: 'WhatsApp Agent',
      goals: ['Reply to incoming customer messages in the voice set for the business; hold anything sensitive for approval'],
      tools: [TOOL],
    });
  }

  /** Recent messages with this contact (oldest first), not counting the one being answered. */
  async recentHistory({ session, from, userId, workspaceId, body }) {
    if (!session) return [];
    try {
      const store = require('../../core/whatsapp/store');
      const messages = await store.listMessages({ userId, workspaceId }, from, 12);
      const last = messages[messages.length - 1];
      if (last && last.direction === 'in' && msgText(last) === (body || '')) messages.pop();
      return messages;
    } catch (err) {
      console.warn(`[WhatsAppAgent] couldn't load conversation history: ${err.message}`);
      return [];
    }
  }

  /** Draft Ian's reply. Returns { reply, hold, reason } (reply already cleaned up). */
  async draftReply({ body, history, workspaceId, v, profile, now = new Date() }) {
    // Business profile + the Q&A entries that match this message (switched-on ones only).
    const previousIn = [...history].reverse().find((m) => m.direction === 'in');
    const [profileLine, found] = await Promise.all([
      businessContextLine(workspaceId, { forChat: true }),
      retrieval.forMessage(workspaceId, body, previousIn ? msgText(previousIn) : ''),
    ]);
    const knowledge = `${profileLine}${found.block}`;
    const time = voice.ghanaTime(now);
    const lastOut = [...history].reverse().find((m) => m.direction === 'out');
    const midConversation = !!(lastOut && now - new Date(lastOut.sent_at) < GREETING_GAP_MS);
    const firstContact = !history.some((m) => m.direction === 'in');

    const situation = [
      `It is ${time.clock} in Ghana (${time.partOfDay}).`,
      midConversation
        ? "You're in the middle of a conversation: don't greet again, just answer."
        : `This starts a conversation: begin with "${time.greeting}".`,
      firstContact
        ? `This is the first time they have ever messaged ${profile?.business_name || 'the business'}.`
        : 'They have messaged before (not a first-time contact).',
    ];
    const transcript = history.length
      ? `Conversation so far:\n${history.slice(-10).map((m) => `${m.direction === 'in' ? 'Customer' : v.agentName}: ${msgText(m)}`).join('\n')}\n\n`
      : '';

    const result = await selectProvider({}).complete({
      maxTokens: 800,
      system: `${v.instructions}\n\n${v.examplesBlock ? `${v.examplesBlock}\n\n` : ''}${knowledge}Right now:\n- ${situation.join('\n- ')}\n\n${OUTPUT_FORMAT}`,
      prompt: `${transcript}Customer's latest message: "${body}"`,
    });

    const parsed = replyPolicy.parseDraft(result.text);
    const reply = replyPolicy.cleanReply(parsed.reply, { signature: v.signature || '', profileSignature: profile?.signature, agentName: v.agentName });
    // The owner's profile name is checked so Ian never borrows it - unless the voice
    // file itself names that person (e.g. the founder), who Ian may talk about.
    const ownerName = profile?.display_name && !v.instructions.toLowerCase().includes(String(profile.display_name).toLowerCase())
      ? profile.display_name : null;
    const decision = replyPolicy.decideRouting({
      incoming: body, draft: reply, modelHold: parsed.hold, modelReason: parsed.reason, knowledge, ownerName,
      agentName: v.agentName, businessName: profile?.business_name || null,
    });
    return { reply, ...decision, history, knowledgeUsed: { qa: found.qa, docs: found.docs } };
  }

  async send({ from, text, session, workspaceId, label }) {
    const task = await this.createApprovalTask({
      instruction: `${label} on WhatsApp to ${from}`,
      tool: TOOL,
      payload: session ? { to: from, body: text, session } : { to: from, body: text },
      workspaceId,
    });
    // Lazy require - see TelegramAgent.js (circular via core/orchestrator -> agents/registry -> this file).
    const done = await require('../../core/orchestrator').approveTask(task.id, { workspaceId });
    return { taskId: task.id, sent: !done || done.status !== 'failed' };
  }

  /**
   * @param {object} msg
   * @param {string} msg.from - customer's number
   * @param {string} msg.body - their message
   * @param {string} [msg.workspaceId]
   * @param {string} [msg.session] - WAHA session it arrived on; the reply goes out from the same one
   * @param {string} [msg.userId] - admin who owns the session (for conversation history)
   * @returns {Promise<{draft: string, held: boolean, reason: string, autoSent: boolean, holdSent: boolean, approvalTaskId: string}>}
   */
  async handleIncomingMessage({ from, body, workspaceId: wsFromWebhook, session = null, userId = null, now = new Date() }) {
    const workspaceId = wsFromWebhook || null;
    const profile = workspaceId ? await businessProfile.getProfile(workspaceId).catch(() => null) : null;
    // This workspace's instructions, examples and hold reply (falls back to whatsapp-voice.md).
    const v = await agentSettings.forAgent(workspaceId, profile);
    v.hold = v.holdReply;
    const history = await this.recentHistory({ session, from, userId, workspaceId, body });

    // The AI service can be overloaded (Gemini 503 / timeouts). Try once more after a
    // short wait; if it's still down, the client must not be left in silence - the
    // owner is alerted to attend to them.
    let drafted;
    try {
      drafted = await this.draftReply({ body, history, workspaceId, v, profile, now });
    } catch (firstErr) {
      console.warn(`[WhatsAppAgent] AI couldn't draft a reply to ${from} (${firstErr.message}) - retrying in ${Math.round(WhatsAppAgent.retryDelayMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, WhatsAppAgent.retryDelayMs));
      try {
        drafted = await this.draftReply({ body, history, workspaceId, v, profile, now });
      } catch (err) {
        console.warn(`[WhatsAppAgent] AI still unavailable for ${from} (${err.message}) - no reply sent, owner alerted`);
        await activityLog.record(this.role, 'ai_unavailable', from, { error: err.message, workspaceId }).catch(() => {});
        const results = await notifications.notifyOwnerAttention({
          channel: 'WhatsApp', from, customerMessage: body, workspaceId,
          problem: `${v.agentName} couldn't answer because the AI service is busy right now`,
        }).catch((e) => ({ error: e.message }));
        console.log(`[WhatsAppAgent] owner alerted about ${from}: ${JSON.stringify(results)}`);
        return { draft: '', held: true, reason: 'AI unavailable', autoSent: false, holdSent: false, approvalTaskId: null, ownerAlerted: true };
      }
    }
    const { reply: draft, hold, reason: holdReason } = drafted;
    let held = hold;
    let reason = holdReason;

    const autoReplyOn = session ? config.whatsapp.autoReply : config.autoReply.whatsapp.enabled;
    if (autoReplyOn && !held) {
      const sentToday = await countSentToday(TOOL).catch(() => 0);
      if (sentToday >= config.autoReply.dailyLimitPerChannel) {
        held = true;
        reason = `daily auto-reply limit (${config.autoReply.dailyLimitPerChannel}) reached`;
      }
    }

    const result = { draft, held: held || !autoReplyOn, reason: autoReplyOn ? reason : 'auto-reply is off', autoSent: false, holdSent: false, approvalTaskId: null };

    if (autoReplyOn && !held) {
      const sent = await this.send({ from, text: draft, session, workspaceId, label: 'Reply' });
      result.approvalTaskId = sent.taskId;
      result.autoSent = sent.sent;
      await activityLog.record(this.role, 'auto_reply_sent', from, { approvalTaskId: sent.taskId, reason, workspaceId });
      if (sent.sent) {
        notifications.notifyOwnerFyi({ channel: 'whatsapp', from, customerMessage: body, sentReply: draft })
          .catch((err) => console.warn(`[WhatsAppAgent] FYI notification failed: ${err.message}`));
        return result;
      }
      // Send failed: fall through so the owner hears about it and can retry from Tasks.
      result.held = true;
      result.reason = 'the automatic reply failed to send';
    }

    // Held (or auto-reply off): Ian's suggested answer waits for approval.
    const approvalTask = await this.createApprovalTask({
      instruction: `Reply on WhatsApp to ${from}`,
      tool: TOOL,
      payload: session ? { to: from, body: draft, session } : { to: from, body: draft },
      workspaceId,
    });
    result.approvalTaskId = approvalTask.id;
    await activityLog.record(this.role, 'auto_reply_blocked', from, { approvalTaskId: approvalTask.id, reason: result.reason, workspaceId });

    // Tell the customer we're on it - once, not after every message.
    if (autoReplyOn && result.autoSent === false && held) {
      const lastOut = [...history].reverse().find((m) => m.direction === 'out');
      const alreadyTold = lastOut && msgText(lastOut).trim() === v.hold.trim() && now - new Date(lastOut.sent_at) < HOLD_REPEAT_MS;
      if (!alreadyTold) {
        const sent = await this.send({ from, text: v.hold, session, workspaceId, label: 'Holding reply' })
          .catch((err) => ({ sent: false, error: err }));
        result.holdSent = !!sent.sent;
      }
    }

    notifications
      .notifyOwnerPendingApproval({
        channel: 'whatsapp', from, customerMessage: body, draftReply: draft, approvalTaskId: approvalTask.id, workspaceId,
        reason: result.reason, customerToldText: result.holdSent ? v.hold : null,
      })
      .catch((err) => console.warn(`[WhatsAppAgent] owner notification failed: ${err.message}`));

    return result;
  }
}

/** Wait before retrying when the AI service is busy (WA_AI_RETRY_DELAY_MS, default 20s). */
WhatsAppAgent.retryDelayMs = Number(process.env.WA_AI_RETRY_DELAY_MS) || 20000;

module.exports = WhatsAppAgent;
