const config = require('../config');
const memory = require('../memory');
const { selectProvider } = require('./router');
const { businessContextLine, hasBusinessKnowledge } = require('./businessContext');

/**
 * autoReplySafety.js - the gate an incoming-message reply must pass before
 * it's allowed to auto-send instead of waiting for human approval.
 *
 * Checks, in order, cheapest/most-certain first. ANY of them failing
 * routes back to manual approval:
 *   1. Sensitive-topic keyword check (refunds, complaints, legal, medical,
 *      etc.) - ALWAYS routes to a human, even if your business.json has a
 *      written policy covering it. A written policy answers "what's the
 *      rule" - handling a real refund request or an upset customer also
 *      needs judgment (goodwill exceptions, tone, when to escalate) that a
 *      factual lookup doesn't capture. This is a business-risk category,
 *      not a knowledge-availability one.
 *   2. Placeholder/fabrication detector - deterministic, not LLM-judged.
 *   3. Daily per-channel send limit.
 *   4. Knowledge-groundedness: is the drafted reply actually, confidently
 *      supported by the business info you've provided (hours, pricing,
 *      services, policies, FAQ)? If the topic isn't covered, or the reply
 *      would require guessing/general knowledge beyond what you've fed it,
 *      it goes to a human instead of the AI guessing at a real customer.
 *      Fails CLOSED (routes to human) on any error, never fails open.
 */

const RISK_KEYWORDS = [
  'refund', 'cancel', 'cancellation', 'chargeback', 'complaint', 'complain',
  'lawsuit', 'lawyer', 'legal', 'sue', 'fraud', 'scam', 'stolen', 'hacked',
  'angry', 'furious', 'unacceptable', 'terrible', 'worst', 'disgusted',
  'credit card', 'password', 'social security', 'ssn', 'bank account',
  'medical', 'diagnosis', 'emergency', 'suicide', 'self harm', 'self-harm',
  'discount', 'negotiate', 'price match', 'compensation', 'deposit',
];

function containsRiskKeyword(text) {
  const lower = (text || '').toLowerCase();
  return RISK_KEYWORDS.find((k) => lower.includes(k)) || null;
}

// Deterministic, not LLM-judged - a real customer received a fabricated
// website URL that an LLM groundedness check incorrectly approved as
// "grounded." This check exists BECAUSE an LLM verdict alone proved
// unreliable for something this consequential: never trust a model's
// self-assessment as the only line of defense against it inventing a
// specific fact (a URL, a placeholder brand name) that sounds plausible.
const PLACEHOLDER_PATTERNS = [
  /\[[^\]\n]{2,80}\]/, // literal unfilled [bracket placeholder] text
  /\bourbusiness\.com\b/i,
  /\byourcompany\.com\b/i,
  /\byourbusiness\.com\b/i,
  /\byourwebsite\.com\b/i,
  /\bexample\.com\b/i,
  /\bacme\.com\b/i,
  /\blorem ipsum\b/i,
  /\bwhat you do\b/i,
  /\bcore benefit\b/i,
];

function containsPlaceholderText(text) {
  const match = PLACEHOLDER_PATTERNS.find((p) => p.test(text || ''));
  return match ? match.toString() : null;
}

async function countSentToday(tool) {
  const allTasks = await memory.listTasks();
  const today = new Date().toISOString().slice(0, 10);
  return allTasks.filter(
    (t) => t.toolCall?.tool === tool && t.status === 'done' && (t.updated_at || t.created_at || '').slice(0, 10) === today
  ).length;
}

/**
 * @param {object} params
 * @param {string} params.channel - 'telegram' | 'whatsapp' (used to build the tool name and daily-limit key)
 * @param {string} params.incomingMessage - the customer's original message
 * @param {string} params.draftReply - the drafted reply text
 * @returns {Promise<{safe: boolean, reason: string}>}
 */
async function classifyReplySafety({ channel, incomingMessage, draftReply }) {
  const incomingRisk = containsRiskKeyword(incomingMessage);
  if (incomingRisk) {
    return { safe: false, reason: `Customer's message touches a risk-category topic ("${incomingRisk}") - always routed to human review regardless of business info` };
  }

  const draftRisk = containsRiskKeyword(draftReply);
  if (draftRisk) {
    return { safe: false, reason: `Drafted reply touches a risk-category topic ("${draftRisk}") - always routed to human review regardless of business info` };
  }

  const placeholder = containsPlaceholderText(draftReply);
  if (placeholder) {
    return { safe: false, reason: `Drafted reply contains obvious placeholder/template text (matched: ${placeholder}) - never send fabricated or unfilled content to a real customer` };
  }

  const toolName = `${channel}.sendMessage`;
  const sentToday = await countSentToday(toolName);
  if (sentToday >= config.autoReply.dailyLimitPerChannel) {
    return { safe: false, reason: `Daily auto-reply limit (${config.autoReply.dailyLimitPerChannel}) already reached for ${channel}` };
  }

  if (!hasBusinessKnowledge()) {
    return { safe: false, reason: 'No business info configured yet - nothing for the AI to confidently ground an answer in, so it defaults to human review' };
  }

  // Final check: is this reply actually supported by the business info
  // provided, or would it require guessing? Fails CLOSED on any error.
  try {
    const provider = selectProvider({});
    const result = await provider.complete({
      maxTokens: 60,
      system:
        `${businessContextLine()}You are a strict fact-checker for an auto-reply customer messaging bot. Respond ` +
        'with ONLY "GROUNDED" or "NOT_GROUNDED". Say GROUNDED only if every factual claim in the drafted reply is ' +
        'directly supported by the business knowledge above - the customer\'s question is genuinely covered by it, ' +
        'not just plausible. If the reply states ANY specific fact - a URL, website, phone number, address, price, ' +
        'or name - that does NOT appear word-for-word in the business knowledge above, respond NOT_GROUNDED, even ' +
        'if the fact sounds reasonable or generic. A specific-sounding detail the business knowledge never actually ' +
        'stated is a fabrication, not a safe answer. Say NOT_GROUNDED if the reply guesses, hedges, relies on ' +
        'general knowledge not stated above, or the business knowledge simply doesn\'t cover what was asked.',
      prompt: `Customer message: "${incomingMessage}"\n\nDrafted reply: "${draftReply}"`,
    });
    const verdict = result.text.trim().toUpperCase();
    if (verdict.includes('GROUNDED') && !verdict.includes('NOT_GROUNDED')) {
      return { safe: true, reason: 'Passed risk-keyword and rate checks; reply is confidently grounded in the provided business info' };
    }
    return { safe: false, reason: 'Reply is not clearly grounded in the provided business info - routed to human rather than letting the AI guess' };
  } catch (err) {
    return { safe: false, reason: `Safety classification failed (${err.message}) - defaulting to human review` };
  }
}

module.exports = { classifyReplySafety, containsRiskKeyword, RISK_KEYWORDS };