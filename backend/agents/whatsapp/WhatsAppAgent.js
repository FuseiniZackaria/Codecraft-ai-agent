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
const catalogSearch = require('../../core/catalog/search');
const imageUnderstanding = require('../../core/whatsapp/imageUnderstanding');
const linkReader = require('../../core/whatsapp/linkReader');
const replyPolicy = require('../../core/whatsapp/replyPolicy');

/**
 * WhatsAppAgent - triggered by the webhook receiver on each incoming customer
 * message, not a user goal, so it skips the standard plan/execute loop.
 *
 * How it speaks - its name, instructions and example replies - is set per
 * workspace on Settings -> General -> Agent instructions
 * (core/knowledge/agentSettings.js), and applies on the next reply.
 *
 * With auto-reply on (WAHA: WA_AUTO_REPLY, default on; Twilio/Meta:
 * WHATSAPP_AUTO_REPLY_ENABLED):
 *   - general questions and enquiries are answered straight away, and the
 *     owner gets a Telegram FYI (nothing to approve);
 *   - pricing/quotes, deals, deadlines/promises, payments, complaints or
 *     anything Ian doesn't know are HELD: the customer gets NO message (never
 *     "let me check with the team"), Ian's suggested answer waits on the Tasks
 *     page, and the owner is alerted to reply or approve (core/notifications.js).
 * With auto-reply off, every reply waits for approval, as before.
 *
 * Every send - automatic or approved - goes through the same approval-task
 * path (createApprovalTask + approveTask), so it's all in the audit trail.
 */

const TOOL = 'whatsapp.sendMessage';
const GREETING_GAP_MS = 6 * 60 * 60 * 1000; // no message from Ian for 6h = a new conversation, greet again
// Sent when a customer says they've paid or sends proof: a person checks the money arrived first.


const OUTPUT_FORMAT =
  'Answer with ONLY a JSON object, nothing else:\n' +
  '{"reply": "<your WhatsApp message to the customer>", "hold": <true or false>, "reason": "<if hold: why, in a few words; else empty>", "sources": [<labels of the Q&A, document parts or products you used, e.g. "Q2", "D1", "P1"; [] if none>], "photos": [<labels of products whose photo to send with your reply, e.g. "P1" - at most 3, only when they asked to see it, sent a photo of something similar, or it clearly helps; [] otherwise>], ' +
  '"lead": {"name": "<their name or null>", "business_type": "<e.g. restaurant, salon, or null>", "need": "<website | ecommerce | design | ai_assistant | seo | other | null>", "budget": "<as they said it, or null>", "timeline": "<as they said it, or null>", "location": "<or null>", "status": "<interested | not_interested | null>", "summary": "<one short sentence: who they are and what they want, from the whole conversation>"}}\n' +
  'In "lead", only put what the customer actually said (in this message or earlier) - never guess; use null for anything unknown.\n' +
  'If hold is true, "reply" is your suggested answer for the team to check before it is sent.\n' +
  "If the answer isn't in the business knowledge you were given, don't guess: set hold to true (the team will answer it themselves). Never tell the customer you are checking with the team.";

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
  async draftReply({ body, history, workspaceId, v, profile, now = new Date(), photoTerms = [], paymentPhoto = false }) {
    // Business profile + the Q&A, documents and products that match this message.
    const previousIn = [...history].reverse().find((m) => m.direction === 'in');
    const previous = previousIn ? msgText(previousIn) : '';
    const [profileLine, found, catalog, shared] = await Promise.all([
      businessContextLine(workspaceId, { forChat: true }),
      retrieval.forMessage(workspaceId, body, previous),
      catalogSearch.forMessage(workspaceId, { message: body, previous, extraTerms: photoTerms }),
      // Links the customer sent: opened and read (no extra AI call).
      linkReader.forMessage(body).catch(() => ({ links: [], block: '' })),
    ]);
    const knowledge = `${profileLine}${catalog.block}${found.block}${shared.block}`;
    const time = voice.ghanaTime(now);
    const lastOut = [...history].reverse().find((m) => m.direction === 'out');
    const midConversation = !!(lastOut && now - new Date(lastOut.sent_at) < GREETING_GAP_MS);
    const firstContact = !history.some((m) => m.direction === 'in');

    const situation = [
      `It is ${time.clock} where the business is (${process.env.WA_PLACE || 'Ghana'}) - ${time.partOfDay}.`,
      midConversation
        ? "You're in the middle of a conversation: don't greet again, just answer."
        : `This starts a conversation: begin with "${time.greeting}".`,
      firstContact
        ? `This is the first time they have ever messaged ${profile?.business_name || 'the business'}.`
        : 'They have messaged before (not a first-time contact).',
      // A greeting must not be held because of an older question in the transcript.
      // Lead capture: learned naturally, never like a form.
      'Over the conversation, get to know them naturally: their name, type of business, what they need, budget or timeline, and where they are. Ask at most ONE of these per reply, only when it fits what they said, never a list of questions, and never something they already told you. Answering them always comes first.',
      "Decide \"hold\" from the customer's LATEST message only. If it is just a greeting, thanks or small talk, reply to it normally (hold = false), even if an earlier question is still waiting.",
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
      // A photo of a receipt / MoMo screen counts as "I've paid": never confirmed by Ian.
      incoming: paymentPhoto ? `${body} (proof of payment)` : body, draft: reply, modelHold: parsed.hold, modelReason: parsed.reason, knowledge, ownerName,
      agentName: v.agentName, businessName: profile?.business_name || null,
    });
    // Product photos to send with the reply: only products that have a photo or a link.
    const photos = (parsed.photos || [])
      .map((label) => catalog.products.find((x) => x.label === label))
      .filter((x) => x && (x.image_url || x.product_url))
      .slice(0, 3);
    return {
      reply, ...decision, history, photos, lead: parsed.lead || null,
      knowledgeUsed: { qa: found.qa, docs: found.docs, products: catalog.products, links: shared.links, cited: parsed.sources || [] },
    };
  }

  async send({ from, text, session, workspaceId, label, image = null, linkPreview = false }) {
    const payload = session ? { to: from, body: text, session } : { to: from, body: text };
    if (image) payload.image = image; // { url } - a product photo; body is its caption
    if (linkPreview) payload.linkPreview = true;
    const task = await this.createApprovalTask({
      instruction: `${label} on WhatsApp to ${from}`,
      tool: TOOL,
      payload,
      workspaceId,
    });
    // Lazy require - see TelegramAgent.js (circular via core/orchestrator -> agents/registry -> this file).
    const done = await require('../../core/orchestrator').approveTask(task.id, { workspaceId });
    return { taskId: task.id, sent: !done || done.status !== 'failed' };
  }

  /**
   * Send product photos after a reply went out. Caption = the product name only
   * (prices always wait for approval). If a photo can't be sent - or there is
   * no photo - the product's link is sent with a preview instead.
   * Returns [{ product, how: 'photo' | 'link' | 'failed' }].
   */
  async sendPhotos({ from, session, workspaceId, photos }) {
    const results = [];
    for (const p of photos) {
      let how = 'failed';
      if (p.image_url) {
        const sent = await this.send({ from, text: p.name, session, workspaceId, label: 'Product photo', image: { url: p.image_url } })
          .catch(() => ({ sent: false }));
        if (sent.sent) how = 'photo';
      }
      if (how === 'failed' && p.product_url) {
        const sent = await this.send({ from, text: `${p.name}: ${p.product_url}`, session, workspaceId, label: 'Product link', linkPreview: true })
          .catch(() => ({ sent: false }));
        if (sent.sent) how = 'link';
      }
      results.push({ product: p.name, how });
    }
    return results;
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
  async handleIncomingMessage({ from, body: rawBody = '', image = null, workspaceId: wsFromWebhook, session = null, userId = null, now = new Date() }) {
    const workspaceId = wsFromWebhook || null;
    const profile = workspaceId ? await businessProfile.getProfile(workspaceId).catch(() => null) : null;
    // This workspace's instructions, examples and hold reply (falls back to whatsapp-voice.md).
    const v = await agentSettings.forAgent(workspaceId, profile);
    v.hold = v.holdReply;
    const history = await this.recentHistory({ session, from, userId, workspaceId, body: rawBody || '[image]' });

    // A photo: look at it first, then answer as if they'd described it.
    let seen = null;
    if (image) {
      try {
        seen = await imageUnderstanding.describe(image);
      } catch (err) {
        console.warn(`[WhatsAppAgent] couldn't read the photo from ${from}: ${err.message}`);
        // No caption to go on: the owner is alerted instead (messaging.js).
        if (!rawBody) return { draft: '', held: true, reason: "couldn't read the photo", autoSent: false, holdSent: false, approvalTaskId: null, imageUnreadable: true };
      }
    }
    const body = seen ? imageUnderstanding.asMessageText(seen, rawBody) : rawBody;
    const photoOpts = seen ? { photoTerms: seen.searchTerms, paymentPhoto: seen.payment } : {};

    // The AI service can be overloaded (Gemini 503 / timeouts). Try once more after a
    // short wait; if it's still down, the client must not be left in silence - the
    // owner is alerted to attend to them.
    let drafted;
    try {
      drafted = await this.draftReply({ body, history, workspaceId, v, profile, now, ...photoOpts });
    } catch (firstErr) {
      console.warn(`[WhatsAppAgent] AI couldn't draft a reply to ${from} (${firstErr.message}) - retrying in ${Math.round(WhatsAppAgent.retryDelayMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, WhatsAppAgent.retryDelayMs));
      try {
        drafted = await this.draftReply({ body, history, workspaceId, v, profile, now, ...photoOpts });
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
    const { reply: draft, hold, reason: holdReason, kind } = drafted;
    let held = hold;

    // Leads page: what Ian learned, the status, and a hot-lead alert (once a day).
    if (workspaceId && session) {
      await require('../../core/leads').applyFromAgent({ workspaceId, contactNumber: from, info: drafted.lead, incoming: body })
        .catch((err) => console.warn(`[WhatsAppAgent] lead update failed: ${err.message}`));
    }
    let reason = holdReason;

    const autoReplyOn = session ? config.whatsapp.autoReply : config.autoReply.whatsapp.enabled;
    if (autoReplyOn && !held) {
      const sentToday = await countSentToday(TOOL).catch(() => 0);
      if (sentToday >= config.autoReply.dailyLimitPerChannel) {
        held = true;
        reason = `daily auto-reply limit (${config.autoReply.dailyLimitPerChannel}) reached`;
      }
    }

    const result = { seen, draft, held: held || !autoReplyOn, reason: autoReplyOn ? reason : 'auto-reply is off', autoSent: false, holdSent: false, approvalTaskId: null };

    if (autoReplyOn && !held) {
      const sent = await this.send({ from, text: draft, session, workspaceId, label: 'Reply' });
      result.approvalTaskId = sent.taskId;
      result.autoSent = sent.sent;
      await activityLog.record(this.role, 'auto_reply_sent', from, { approvalTaskId: sent.taskId, reason, workspaceId });
      if (sent.sent) {
        // Product photos the reply refers to (the reply itself went out first).
        if (drafted.photos?.length) result.photos = await this.sendPhotos({ from, session, workspaceId, photos: drafted.photos });
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

    // The customer is NOT told "let me check with the team": Ian says nothing, and the
    // owner replies themselves or approves Ian's suggestion (owner's rule, 2026-11-06).

    notifications
      .notifyOwnerPendingApproval({
        channel: 'whatsapp', from, customerMessage: body, draftReply: draft, approvalTaskId: approvalTask.id, workspaceId,
        reason: result.reason, customerToldText: null,
      })
      .catch((err) => console.warn(`[WhatsAppAgent] owner notification failed: ${err.message}`));

    return result;
  }
}

/** Wait before retrying when the AI service is busy (WA_AI_RETRY_DELAY_MS, default 20s). */
WhatsAppAgent.retryDelayMs = Number(process.env.WA_AI_RETRY_DELAY_MS) || 20000;

module.exports = WhatsAppAgent;

