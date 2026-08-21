const { v4: uuid } = require('uuid');
const { selectProvider } = require('../router');
const { classify } = require('./keywordClassifier');
const { classifyIntent } = require('../intentClassifier');

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

// Maps an intent category to the resulting agent/toolCall. Centralized here
// so both the LLM path and (indirectly, via keywordClassifier's fallback
// mapping in intentClassifier.js) the offline path produce identical routing.
async function routeByCategory(category, goal, explicitPayload, history) {
  let agent = 'research'; // default - covers 'research' and 'conversational' (the latter only reached when decompose() is called directly, e.g. via API/command palette, bypassing chat's actionable gate)
  let toolCall = null;
  let extractedPayload = null;

  switch (category) {
    case 'inbox_triage':
      agent = 'personal-assistant';
      break;
    case 'support':
      agent = 'support';
      break;
    case 'outreach':
      agent = 'sales';
      break;
    case 'ceo':
      agent = 'ceo';
      break;
    case 'content_studio':
      // Pure text generation, nothing sent/published anywhere - no approval gate needed.
      agent = 'content-studio';
      break;
    case 'coding':
      // Writes only to a sandboxed local workspace - not irreversible in the
      // send-an-email/push-to-github sense, so no approval gate needed.
      agent = 'coding';
      break;
    case 'marketing':
      agent = 'marketing';
      break;
    case 'github':
      // Only the single-line "create a repo" case is auto-wired here -
      // createOrUpdateFile/createPullRequest need more structured input
      // (owner/repo/branch/path) than a casual sentence reliably provides,
      // so those stay available as tools without automatic chat extraction.
      toolCall = { tool: 'github.createRepository', irreversible: true };
      if (!explicitPayload) extractedPayload = await extractArgs(goal, ['name', 'description', 'private'], history);
      break;
    case 'whatsapp':
      toolCall = { tool: 'whatsapp.sendMessage', irreversible: true };
      if (!explicitPayload) extractedPayload = await extractArgs(goal, ['to', 'body'], history);
      break;
    case 'email_send':
      toolCall = { tool: 'gmail.sendEmail', irreversible: true };
      if (!explicitPayload) extractedPayload = await extractArgs(goal, ['to', 'subject', 'body'], history);
      break;
    case 'research':
    case 'conversational':
    default:
      agent = 'research';
  }

  return { agent, toolCall, extractedPayload };
}

/**
 * Decomposes a high-level goal into a task list.
 *
 * @param {string} goal
 * @param {object} explicitPayload - structured args supplied by the caller
 *   (e.g. a form), which take priority over anything extracted from text.
 * @param {Array} history - recent chat history, for reference resolution.
 * @param {string} precomputedCategory - if the caller (chat.js) already
 *   classified this message, pass the category through to avoid a second,
 *   redundant LLM classification call for the same message.
 */
async function decompose(goal, explicitPayload = null, history = [], precomputedCategory = null) {
  const { category } = precomputedCategory ? { category: precomputedCategory } : await classifyIntent(goal, history);
  const { agent, toolCall, extractedPayload } = await routeByCategory(category, goal, explicitPayload, history);

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
