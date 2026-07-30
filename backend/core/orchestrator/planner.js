const { v4: uuid } = require('uuid');
const { selectProvider } = require('../router');

/**
 * When a goal maps to a tool call (e.g. "send an email to..."), the user's
 * natural-language sentence needs to become structured arguments the tool
 * actually accepts (to/subject/body). This asks the LLM to extract them.
 * Falls back to an empty object on any failure - the tool's own validation
 * (e.g. "requires to and subject") will then surface a clear error instead
 * of silently guessing.
 */
async function extractArgs(goal, fields, history = []) {
  try {
    const provider = selectProvider({});
    const contextLine = history.length
      ? `Recent conversation for context (the request may reference things mentioned here, like "the jobs" or "each"):\n${history
          .slice(-6)
          .map((h) => `${h.role}: ${h.content}`)
          .join('\n')}\n\n---\n\n`
      : '';
    const result = await provider.complete({
      system:
        `Extract structured data from the user's request for these fields: ${fields.join(', ')}. ` +
        `Respond with ONLY a JSON object, no markdown, no explanation. ` +
        `IMPORTANT: always include every field, even if not explicitly stated - infer a reasonable ` +
        `value instead (e.g. write a short, natural subject line summarizing the message if none was ` +
        `given; use the user's own wording for the body rather than leaving it empty). If the request ` +
        `references earlier conversation (e.g. "the jobs", "each", "that company"), use the provided ` +
        `context to resolve what it actually means - don't just restate the request itself as the body. ` +
        `Only use an empty string for a field if there truly is nothing to infer it from even with context ` +
        `(e.g. no recipient mentioned or inferable anywhere).`,
      prompt: `${contextLine}Current request: ${goal}`,
    });
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[planner] no JSON object found in extraction response for "${goal}": ${result.text.slice(0, 200)}`);
      return {};
    }
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`[planner] arg extraction failed for "${goal}": ${err.message}`);
    return {};
  }
}

/**
 * Decides what kind of actionable request (if any) a message maps to.
 * Shared between the orchestrator (which always creates a task) and the
 * chat endpoint (which only creates a task for genuinely actionable
 * messages, and replies conversationally for everything else).
 */
function classify(goal) {
  const lower = goal.toLowerCase();

  const isInboxTriage =
    lower.includes('check my inbox') ||
    lower.includes('check the inbox') ||
    lower.includes('check inbox') ||
    lower.includes('triage my inbox') ||
    lower.includes('triage the inbox') ||
    lower.includes('triage my email') ||
    (lower.includes('check') && lower.includes('email'));
  const isSupport =
    !isInboxTriage &&
    (lower.includes('support ticket') ||
      lower.includes('customer question') ||
      lower.includes('customer issue') ||
      lower.includes('respond to customer') ||
      lower.includes('respond to this customer') ||
      lower.includes('help this customer') ||
      lower.includes('customer complain'));
  const isWhatsApp =
    !isInboxTriage &&
    !isSupport &&
    lower.includes('whatsapp') &&
    (lower.includes('send') || lower.includes('message') || lower.includes('text') || lower.includes('reply'));
  const isOutreach =
    !isInboxTriage &&
    !isSupport &&
    !isWhatsApp &&
    (lower.includes('outreach') ||
      lower.includes('reach out') ||
      lower.includes('find leads') ||
      lower.includes('find businesses') ||
      lower.includes('find companies') ||
      lower.includes('scrape') ||
      lower.includes('prospect list') ||
      lower.includes('lead generation') ||
      lower.includes('leads that'));
  const isCEO =
    !isInboxTriage &&
    !isSupport &&
    !isWhatsApp &&
    !isOutreach &&
    (lower.includes('strategy') ||
      lower.includes('should we') ||
      lower.includes('should i focus') ||
      lower.includes('should i prioritize') ||
      lower.includes('business decision') ||
      lower.includes('roadmap') ||
      lower.includes('pivot'));
  const isGithub =
    !isInboxTriage &&
    !isSupport &&
    !isWhatsApp &&
    !isOutreach &&
    !isCEO &&
    lower.includes('github') &&
    (lower.includes('create') || lower.includes('repo') || lower.includes('commit') || lower.includes('pull request'));
  const isMarketing =
    !isInboxTriage &&
    !isSupport &&
    !isWhatsApp &&
    !isOutreach &&
    !isCEO &&
    !isGithub &&
    (lower.includes('marketing') ||
      lower.includes('ad copy') ||
      lower.includes('social media post') ||
      lower.includes('caption for') ||
      lower.includes('tagline') ||
      lower.includes('write a post') ||
      lower.includes('write a blog') ||
      lower.includes('write an ad') ||
      lower.includes('promotional'));
  const isEmailSend =
    !isInboxTriage &&
    !isSupport &&
    !isWhatsApp &&
    !isOutreach &&
    !isCEO &&
    !isGithub &&
    !isMarketing &&
    (lower.includes('email') || lower.includes('send'));
  const isResearch =
    !isInboxTriage &&
    !isSupport &&
    !isWhatsApp &&
    !isOutreach &&
    !isCEO &&
    !isGithub &&
    !isMarketing &&
    !isEmailSend &&
    (lower.startsWith('find me') ||
      lower.startsWith('find ') ||
      lower.startsWith('research ') ||
      lower.includes('look up') ||
      lower.includes('search for') ||
      lower.includes('find opportunities') ||
      lower.includes('find jobs') ||
      lower.includes('find remote'));

  return {
    isInboxTriage,
    isSupport,
    isWhatsApp,
    isOutreach,
    isCEO,
    isGithub,
    isMarketing,
    isEmailSend,
    isResearch,
    isActionable:
      isInboxTriage ||
      isSupport ||
      isWhatsApp ||
      isOutreach ||
      isCEO ||
      isGithub ||
      isMarketing ||
      isEmailSend ||
      isResearch,
  };
}

/**
 * Decomposes a high-level goal into a task list.
 * This skeleton uses simple keyword routing to pick an agent; a full
 * implementation would use an LLM call to classify/decompose the goal into
 * a task DAG (with dependencies) rather than a flat list.
 *
 * @param {string} goal
 * @param {object} explicitPayload - structured args supplied by the caller
 *   (e.g. a form), which take priority over anything extracted from text.
 */
async function decompose(goal, explicitPayload = null, history = []) {
  const { isInboxTriage, isSupport, isWhatsApp, isOutreach, isCEO, isGithub, isMarketing, isEmailSend } = classify(goal);

  let agent = 'research'; // default agent for this skeleton
  let toolCall = null;
  let extractedPayload = null;

  if (isInboxTriage) {
    agent = 'personal-assistant';
  } else if (isSupport) {
    agent = 'support';
  } else if (isOutreach) {
    agent = 'sales';
  } else if (isCEO) {
    agent = 'ceo';
  } else if (isMarketing) {
    agent = 'marketing';
  } else if (isGithub) {
    // Only the single-line "create a repo" case is auto-wired here -
    // createOrUpdateFile/createPullRequest need more structured input
    // (owner/repo/branch/path) than a casual sentence reliably provides,
    // so those stay available as tools without automatic chat extraction.
    toolCall = { tool: 'github.createRepository', irreversible: true };
    if (!explicitPayload) {
      extractedPayload = await extractArgs(goal, ['name', 'description', 'private'], history);
    }
  } else if (isWhatsApp) {
    toolCall = { tool: 'whatsapp.sendMessage', irreversible: true };
    if (!explicitPayload) {
      extractedPayload = await extractArgs(goal, ['to', 'body'], history);
    }
  } else if (isEmailSend) {
    toolCall = { tool: 'gmail.sendEmail', irreversible: true };
    if (!explicitPayload) {
      extractedPayload = await extractArgs(goal, ['to', 'subject', 'body'], history);
    }
  }

  const task = {
    id: uuid(),
    agent,
    instruction: goal,
    status: 'pending',
    irreversible: !!toolCall?.irreversible,
    toolCall,
    payload: explicitPayload || extractedPayload || null,
    created_at: new Date().toISOString(),
  };

  return [task];
}

module.exports = { decompose, classify };
