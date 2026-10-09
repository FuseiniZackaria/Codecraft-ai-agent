const BaseAgent = require('../base/BaseAgent');
const memory = require('../../memory');
const config = require('../../config');

// Pulls a bare email address out of whatever format the "from" field shows up
// in - "Name <email>", markdown "[text](mailto:email)", or a bare address.
function extractEmail(from) {
  const match = (from || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0].toLowerCase() : null;
}

function myEmailSet() {
  const set = new Set();
  for (const addr of config.myEmailAddresses || []) set.add(addr.toLowerCase());
  if (config.applicant?.email) set.add(config.applicant.email.toLowerCase());
  return set;
}

function isAutomatedSender(email) {
  if (!email) return false;
  return (
    email.startsWith('no-reply@') ||
    email.startsWith('noreply@') ||
    email.startsWith('do-not-reply@') ||
    email.startsWith('donotreply@') ||
    email.startsWith('mailer-daemon@') ||
    email.startsWith('postmaster@') ||
    email.startsWith('bounce@') ||
    email.includes('+noreply@') ||
    email.includes('.noreply@')
  );
}

function isSystemSubject(subject) {
  if (!subject) return false;
  return subject.trim().startsWith('[CodeCraft');
}

/**
 * PersonalAssistantAgent - autonomous inbox triage.
 *
 * Plan: read inbox -> deterministic pre-LLM filter (drops sent-by-me,
 * outreach threads, lead addresses, [CodeCraft/*] mail, automated senders) ->
 * group by thread and keep only threads whose LATEST message is from someone
 * else -> analyze which emails genuinely need a reply -> draft each. The
 * triage run itself is NOT irreversible (it only reads + reasons), but every
 * drafted reply becomes its own separate pending_approval task via
 * createApprovalTask, so you approve or reject each reply individually on
 * the Tasks page rather than one giant "trust me" action.
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

    // Gmail query: inbox only, exclude anything I sent. "-from:me" is Gmail
    // search syntax for "not sent by the authenticated account". "-in:sent"
    // is belt-and-braces against Composio's default returning All Mail.
    const query = 'in:inbox -from:me -in:sent';

    return [
      { type: 'tool_call', tool: 'gmail.readInbox', args: { limit, query } },
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

  /**
   * Deterministic pre-LLM filter. Takes the raw readInbox messages and
   * returns:
   *   { survivors, counters }
   * where survivors is the compact shape the LLM sees, and counters feeds
   * the end-of-run summary. Decisions here are NEVER delegated to the LLM -
   * no "LLM thought this looked automated"; a hardcoded rule either keeps it
   * or drops it.
   */
  async filterMessages(messages) {
    const mine = myEmailSet();

    // 1. Collect every outreach thread id and recipient (sales lane) so we
    //    can drop messages that belong to it either by threadId or by sender.
    let outreachThreadIds = new Set();
    let outreachRecipients = new Set();
    try {
      if (typeof memory.listOutreachThreads === 'function') {
        const rows = await memory.listOutreachThreads();
        for (const r of rows) {
          if (r.threadId) outreachThreadIds.add(r.threadId);
          if (r.recipientEmail) outreachRecipients.add(r.recipientEmail.toLowerCase());
        }
      }
    } catch {
      // Registry read failures are non-fatal - we still filter by my own
      // addresses, [CodeCraft] subject, and automated senders.
    }

    const counters = { myOwn: 0, outreach: 0, app: 0, automated: 0 };
    const perThread = new Map(); // threadId -> array of messages in arrival order

    for (const m of messages) {
      // Composio returns the From header as `m.sender`; the (post-project)
      // compact shape used elsewhere renames it to `m.from`. Accept either so
      // the filter works both in production (raw Composio output) and in tests
      // that pass pre-projected shapes.
      const fromEmail = extractEmail(m.sender || m.from);
      const subject = m.subject || '';
      const threadId = m.threadId || null;

      if (!threadId) continue; // nothing to reply to without a thread

      // Hard drops - never show these to the LLM.
      if (fromEmail && mine.has(fromEmail))                { counters.myOwn++; continue; }
      if (threadId && outreachThreadIds.has(threadId))     { counters.outreach++; continue; }
      if (fromEmail && outreachRecipients.has(fromEmail))  { counters.outreach++; continue; }
      if (isSystemSubject(subject))                        { counters.app++; continue; }
      if (isAutomatedSender(fromEmail))                    { counters.automated++; continue; }

      if (!perThread.has(threadId)) perThread.set(threadId, []);
      perThread.get(threadId).push(m);
    }

    // 2. For each thread, keep only the LATEST message. If its sender is
    //    one of mine (which can happen even after "-from:me" if Composio
    //    returns a thread for some other reason), drop it under myOwn.
    const survivors = [];
    for (const [, msgs] of perThread) {
      // Caller may or may not sort by date; be defensive and pick the last
      // one in iteration order (Gmail returns newest-first by default, so
      // the first is latest; handle both by comparing internalDate when
      // present).
      let latest = msgs[0];
      for (const m of msgs) {
        const a = Number(m.internalDate || 0);
        const b = Number(latest.internalDate || 0);
        if (a > b) latest = m;
      }
      const fromEmail = extractEmail(latest.sender || latest.from);
      if (fromEmail && mine.has(fromEmail)) {
        counters.myOwn++;
        continue;
      }
      survivors.push(latest);
    }

    return { survivors, counters };
  }

  // Post-process the raw readInbox tool result into a compact shape before it
  // gets threaded into the LLM step's context - the raw Gmail response can
  // include large base64 MIME bodies that would blow the prompt budget.
  // Pre-filter stage happens here too - the LLM never sees sent-by-me mail,
  // outreach threads, or app/automated messages.
  async execute(step, task, priorContext) {
    const result = await super.execute(step, task, priorContext);

    if (step.type === 'tool_call' && step.tool === 'gmail.readInbox') {
      const messages = result?.messages || [];
      const { survivors, counters } = await this.filterMessages(messages);
      // Stash counters on the task for reflect() to pick up later. Using a
      // field on the task object avoids coupling to the orchestrator's
      // internal result-array format.
      task._triageCounters = counters;
      task._triageInputCount = messages.length;
      return {
        messages: survivors.map((m) => ({
          threadId: m.threadId,
          from: m.sender || m.from,
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

    const mine = myEmailSet();
    let created = 0;
    let dropped = 0;
    for (const item of toReply) {
      if (existingThreadIds.has(item.threadId)) continue;

      const recipientEmail = extractEmail(item.from);
      if (!recipientEmail) {
        console.warn(`[PersonalAssistantAgent] couldn't extract an email address from "${item.from}" - skipping reply task`);
        dropped++;
        continue;
      }
      // Final belt-and-braces: if the LLM somehow surfaced an item whose
      // "from" is actually me (shouldn't happen after the deterministic
      // filter, but worth guarding), drop it rather than drafting a reply
      // to myself.
      if (mine.has(recipientEmail)) {
        dropped++;
        continue;
      }

      await this.createApprovalTask({
        instruction: `Reply to "${item.subject}" from ${item.from}`,
        tool: 'gmail.replyToThread',
        payload: { threadId: item.threadId, body: item.draftReply, recipientEmail },
      });
      created++;
    }

    const c = task._triageCounters || { myOwn: 0, outreach: 0, app: 0, automated: 0 };
    const inputCount = task._triageInputCount || 0;
    const skippedTotal = c.myOwn + c.outreach + c.app + c.automated;
    const note =
      `Triaged ${items.length} email(s), drafted ${created} new repl${created === 1 ? 'y' : 'ies'} awaiting approval ` +
      `(${toReply.length - created - dropped} already handled in a previous run). ` +
      `Skipped ${skippedTotal} before triage (my own emails: ${c.myOwn}, sales/job outreach: ${c.outreach}, ` +
      `app emails: ${c.app}, automated: ${c.automated}). Fetched ${inputCount} message(s) from Gmail.`;
    await memory.addReflection(this.role, task.id, note);
    return note;
  }
}

module.exports = PersonalAssistantAgent;
