const BaseAgent = require('../base/BaseAgent');
const memory = require('../../memory');

// Pulls a bare email address out of whatever format the "from" field shows up
// in - "Name <email>", markdown "[text](mailto:email)", or a bare address.
function extractEmail(from) {
  const match = (from || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

/**
 * PersonalAssistantAgent - autonomous inbox triage.
 *
 * Plan: read inbox -> analyze which emails genuinely need a reply -> draft each.
 * The triage run itself is NOT irreversible (it only reads + reasons), but
 * every drafted reply becomes its own separate pending_approval task via
 * createApprovalTask - so you approve or reject each reply individually on
 * the Tasks page, rather than one giant "trust me" action.
 */
class PersonalAssistantAgent extends BaseAgent {
  constructor() {
    super({
      key: 'personal-assistant',
      role: 'Personal Assistant Agent',
      goals: ['Keep the inbox triaged - draft replies to what genuinely needs one, leave the rest'],
      tools: ['gmail.readInbox', 'gmail.replyToThread'],
    });
  }

  async plan(task) {
    const limit = Number(task.instruction.match(/\d+/)?.[0] || 10);
    return [
      { type: 'tool_call', tool: 'gmail.readInbox', args: { limit } },
      {
        type: 'llm_call',
        // Scaled to the number of emails - too small a budget here truncates
        // the JSON array mid-response, which silently discards ALL drafted
        // replies (not just the cut-off ones), since the array never parses.
        maxTokens: Math.min(8192, Math.max(2048, limit * 400)),
        instruction:
          'Given the emails above, decide which genuinely need a reply from me - a direct ' +
          'question, meeting request, deadline, or explicit action needed. Newsletters, ' +
          'automated notifications, receipts, and job/listing alerts do NOT need a reply. ' +
          'For each email that needs one, draft a brief, professional reply in my voice - ' +
          'do not be overly formal or robotic, and do not restate the entire original email. ' +
          'Keep each draftReply under 80 words. ' +
          'Respond with ONLY a JSON array (no markdown, no explanation), one entry per email, ' +
          'in this exact shape: ' +
          '[{"threadId": "...", "from": "...", "subject": "...", "needsReply": true|false, "draftReply": "..." or null}]',
      },
    ];
  }

  // Post-process the raw readInbox tool result into a compact shape before it
  // gets threaded into the LLM step's context - the raw Gmail response can
  // include large base64 MIME bodies that would blow the prompt budget.
  async execute(step, task, priorContext) {
    const result = await super.execute(step, task, priorContext);

    if (step.type === 'tool_call' && step.tool === 'gmail.readInbox') {
      const messages = result?.messages || [];
      return {
        messages: messages.map((m) => ({
          threadId: m.threadId,
          from: m.sender,
          subject: m.subject,
          snippet: (m.preview?.body || m.messageText || '').slice(0, 500),
        })),
      };
    }

    return result;
  }

  // After the triage plan runs, parse the drafted-replies JSON and spawn one
  // approval-gated task per email that needs a reply.
  async reflect(task, results) {
    const analysisStep = results[1];
    let items = [];

    if (analysisStep?.truncated) {
      console.warn(
        `[PersonalAssistantAgent] LLM response was truncated (hit max_tokens) - triage results are likely incomplete or unparseable. Consider raising maxTokens further for larger inboxes.`
      );
    }

    try {
      const match = analysisStep?.text?.match(/\[[\s\S]*\]/);
      if (match) {
        items = JSON.parse(match[0]);
      } else {
        console.warn(
          `[PersonalAssistantAgent] no JSON array found in triage output - raw response: ${analysisStep?.text?.slice(0, 300)}`
        );
      }
    } catch (err) {
      console.warn(
        `[PersonalAssistantAgent] failed to parse triage output (${err.message}) - raw response: ${analysisStep?.text?.slice(0, 300)}`
      );
    }

    const toReply = items.filter((i) => i.needsReply && i.threadId && i.draftReply);

    // Dedup against every thread already drafted/handled before (any status) -
    // essential once this runs on a schedule, not just manually, so the same
    // email doesn't get a fresh draft task every polling cycle.
    const existingThreadIds = new Set(
      (await memory.listTasks())
        .filter((t) => t.toolCall?.tool === 'gmail.replyToThread' && t.payload?.threadId)
        .map((t) => t.payload.threadId)
    );

    let created = 0;
    for (const item of toReply) {
      if (existingThreadIds.has(item.threadId)) continue;

      const recipientEmail = extractEmail(item.from);
      if (!recipientEmail) {
        console.warn(`[PersonalAssistantAgent] couldn't extract an email address from "${item.from}" - skipping reply task`);
        continue;
      }

      await this.createApprovalTask({
        instruction: `Reply to "${item.subject}" from ${item.from}`,
        tool: 'gmail.replyToThread',
        payload: { threadId: item.threadId, body: item.draftReply, recipientEmail },
      });
      created++;
    }

    const note = `Triaged ${items.length} email(s), drafted ${created} new repl${created === 1 ? 'y' : 'ies'} awaiting approval (${toReply.length - created} already handled in a previous run).`;
    await memory.addReflection(this.role, task.id, note);
    return note;
  }
}

module.exports = PersonalAssistantAgent;
