const BaseAgent = require('../base/BaseAgent');
const memory = require('../../memory');
const toolRegistry = require('../../tools/ToolRegistry');
const activityLog = require('../../core/activityLog');
const { selectProvider } = require('../../core/router');
const outreachPipeline = require('../../core/outreachPipeline');

// Pulls a bare email address out of whatever format the "from" field shows
// up in - "Name <email>", markdown "[text](mailto:email)", or a bare
// address. Same pattern PersonalAssistantAgent already uses for consistency.
function extractEmail(from) {
  const match = (from || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0].toLowerCase() : null;
}

const CLASSIFICATIONS = [
  'Positive',
  'Negative',
  'Neutral',
  'Interview invitation',
  'Meeting request',
  'Request for more information',
  'Rejection',
  'Follow-up required',
  'Automated response',
  'Opt-out',
];

/**
 * ResponseDetectionAgent - Phase 3 of the Verified Job Outreach system.
 *
 * Monitors the inbox for replies to job outreach that was actually SENT
 * (never AWAITING_APPROVAL - nothing to reply to yet), matches incoming
 * messages to the right pipeline by contact email, classifies each one, and
 * hands the result to outreachPipeline.recordResponse() to update pipeline
 * state and stop the follow-up sequence where appropriate.
 *
 * This agent only reads the inbox and classifies text - it never sends or
 * replies to anything itself, so it needs no approval gate of its own.
 */
class ResponseDetectionAgent extends BaseAgent {
  constructor() {
    super({
      key: 'response-detection',
      role: 'Response Classification Agent',
      goals: ['Detect and classify replies to sent job outreach so follow-ups stop the moment a real response comes in'],
      tools: ['gmail.readInbox'],
    });
  }

  async detectResponses({ limit = 20 } = {}) {
    // Build contactEmail -> pipeline map, but ONLY for pipelines that were
    // actually sent - nothing to reply to for anything still drafted or
    // awaiting approval, and already-responded pipelines don't need
    // re-matching (avoids reprocessing the same thread every run).
    const allTasks = await memory.listTasks();
    const sentPipelines = allTasks.filter(
      (t) => t.payload && t.payload.pipelineType === 'job_outreach_pipeline' && t.payload.stage === outreachPipeline.STAGES.SENT
    );

    if (sentPipelines.length === 0) {
      return { checked: 0, matched: 0, classifications: [], note: 'No sent outreach awaiting responses' };
    }

    // Build contactEmail -> pipeline map, keeping only the MOST RECENTLY
    // SENT pipeline per email. Two reasons this matters, not just one:
    //   1. Correctness: if the same contact was reached out to more than
    //      once (different roles, different times), a reply is far more
    //      likely responding to the latest outreach than an older one -
    //      matching "whichever happens to be last in the array" would be
    //      arbitrary and wrong.
    //   2. Determinism: relying on memory.listTasks()'s incidental
    //      ordering is fragile - MemoryStore and SupabaseStore don't
    //      guarantee the same order, so "last iterated" could silently
    //      mean different things on different backends.
    // Sorting explicitly by sentAt (falling back to created_at) and taking
    // the first match per email makes this deterministic regardless of
    // store or however much history has accumulated.
    const sorted = [...sentPipelines].sort((a, b) => {
      const aTime = new Date(a.payload.sentAt || a.created_at || 0).getTime();
      const bTime = new Date(b.payload.sentAt || b.created_at || 0).getTime();
      return bTime - aTime; // newest first
    });

    const byContactEmail = new Map();
    for (const task of sorted) {
      const email = (task.payload.opportunity?.contactEmail || '').toLowerCase();
      if (email && !byContactEmail.has(email)) byContactEmail.set(email, task); // keep first = most recent
    }

    await activityLog.record(this.role, 'task_started', 'detectResponses', { trackedContacts: byContactEmail.size });

    const inboxResult = await toolRegistry.call('gmail.readInbox', { limit }, { role: this.role });
    const messages = inboxResult?.messages || [];

    const classifications = [];
    for (const message of messages) {
      const senderEmail = extractEmail(message.sender || message.from);
      if (!senderEmail || !byContactEmail.has(senderEmail)) continue;

      const task = byContactEmail.get(senderEmail);
      const alreadyHandled = new Set(task.payload.respondedMessageIds || []);
      const messageId = message.id || message.messageId || message.threadId;
      if (messageId && alreadyHandled.has(messageId)) continue; // already processed this exact message

      const snippet = (message.preview?.body || message.messageText || message.snippet || '').slice(0, 800);
      const classification = await this.classify({
        subject: message.subject,
        snippet,
        jobTitle: task.payload.opportunity?.jobTitle,
        company: task.payload.opportunity?.company,
      });

            const response = {
        classification: classification.category,
        schedulingRequestDetected: classification.schedulingRequestDetected,
        subject: message.subject || null,
        snippet,
        from: senderEmail,
        threadId: message.threadId || null,
        messageId: messageId || null,
        receivedAt: new Date().toISOString(),
      };

      await outreachPipeline.recordResponse(task.id, response);
      await activityLog.record(this.role, 'response_classified', task.payload.opportunity?.company || '', {
        pipelineId: task.id,
        classification: response.classification,
        schedulingRequestDetected: response.schedulingRequestDetected,
      });

      classifications.push({ pipelineId: task.id, ...response });
    }

    return { checked: messages.length, matched: classifications.length, classifications };
  }

  /**
   * Classifies a single inbound message. Grounded only in the actual
   * subject/snippet text - never guesses at intent beyond what's there.
   * Falls back to 'Neutral' (not a stronger category) if the LLM call fails
   * or returns something unparseable, so a hiccup here never silently
   * escalates a message into something like 'Rejection' or 'Opt-out'.
   */
  async classify({ subject, snippet, jobTitle, company }) {
    try {
      const provider = selectProvider({});
      const result = await provider.complete({
        system:
          'Classify this email reply to a job outreach message. Respond with ONLY a JSON object: ' +
          `{"category": one of [${CLASSIFICATIONS.map((c) => `"${c}"`).join(', ')}], "schedulingRequestDetected": true|false}. ` +
          '"schedulingRequestDetected" should be true if the sender is proposing or agreeing to a call/meeting, regardless of category. ' +
          '"Opt-out" is for explicit "don\'t contact me again" / unsubscribe requests. "Automated response" is for out-of-office/autoresponders.',
        prompt: `Original outreach was about: ${jobTitle || 'a role'} at ${company || 'a company'}.\n\nReply subject: ${subject || '(none)'}\nReply body:\n${snippet}`,
        maxTokens: 60,
      });
      const match = result.text.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      if (parsed && CLASSIFICATIONS.includes(parsed.category)) {
        return { category: parsed.category, schedulingRequestDetected: !!parsed.schedulingRequestDetected };
      }
    } catch {
      // fall through to safe default below
    }
    return { category: 'Neutral', schedulingRequestDetected: false };
  }
}

module.exports = ResponseDetectionAgent;