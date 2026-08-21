const { selectProvider } = require('./router');
const { classify: classifyKeywords } = require('./orchestrator/keywordClassifier');

// Each category maps 1:1 to a routing outcome in planner.js's decompose().
// Descriptions are written to be read by the model, not just humans -
// deliberately explicit about what does NOT count, since that's where the
// old keyword system kept colliding (a question that merely mentions a
// topic isn't a request to act on it).
const CATEGORIES = {
  inbox_triage: 'Check/triage the Gmail inbox and draft replies to what needs one. NOT a strategy question that merely mentions "inbox" or "email" as a topic.',
  support: 'Draft a reply to ONE SPECIFIC named customer question, issue, or complaint.',
  whatsapp: 'Send a WhatsApp message to someone.',
  outreach: 'Find sales leads, or draft cold-outreach/prospecting emails to a specific person or company.',
  ceo: 'A business strategy, priorities, or tradeoff question wanting a real recommendation - a question to think through, not a task to execute.',
  content_studio: 'Turn ONE idea/topic/product into a full content package (research + campaign strategy + video scripts + captions + hashtags) - e.g. "promote my X" or "create a campaign for X".',
  coding: 'Build/code/design a real website, app, or system where actual files should be written.',
  github: 'Create a new GitHub repository.',
  marketing: 'Draft a SINGLE piece of marketing content - one email, one social post, one tagline, one ad. NOT a full multi-asset campaign (that is content_studio).',
  email_send: 'Send a specific one-off email to someone.',
  research: 'Look something up, find information, or research a topic - a genuine question needing real facts/search.',
  conversational: 'Casual chat, small talk, or a question answerable directly from general knowledge - anything not clearly requesting one of the actions above.',
};

function fallbackViaKeywords(goal) {
  const k = classifyKeywords(goal);
  let category = 'conversational';
  if (k.isInboxTriage) category = 'inbox_triage';
  else if (k.isSupport) category = 'support';
  else if (k.isWhatsApp) category = 'whatsapp';
  else if (k.isOutreach) category = 'outreach';
  else if (k.isCEO) category = 'ceo';
  else if (k.isContentStudio) category = 'content_studio';
  else if (k.isCoding) category = 'coding';
  else if (k.isGithub) category = 'github';
  else if (k.isMarketing) category = 'marketing';
  else if (k.isEmailSend) category = 'email_send';
  else if (k.isResearch) category = 'research';
  return { category, isActionable: k.isActionable, usedFallback: true };
}

const EXAMPLES = [
  ['Check my inbox and reply to what needs a reply', 'inbox_triage'],
  ['Respond to this customer complaint about a late delivery', 'support'],
  ['Send a whatsapp message to +233123456789 saying hello', 'whatsapp'],
  ['Find leads that need WhatsApp automation for their business', 'outreach'],
  ['Should we prioritize the WhatsApp integration or improving inbox triage next quarter?', 'ceo'],
  ['Promote my new restaurant', 'content_studio'],
  ['Build me a landing page for a bakery', 'coding'],
  ['Build a ministry website with a contact form, email signup, and WhatsApp/Facebook share buttons on every page', 'coding'],
  ['Create a github repo called my-project', 'github'],
  ['Write a marketing email announcing our new feature', 'marketing'],
  ['Send an email to jane@example.com about the meeting', 'email_send'],
  ['Research competitors in the AI automation space', 'research'],
  ['Look up the latest trends in email marketing', 'research'],
  ['What is the capital of France', 'conversational'],
  ['How are you doing today', 'conversational'],
];

/**
 * Classifies a message into exactly one category via a single, small LLM
 * call. This is the PRIMARY routing mechanism - replaces the old keyword
 * matching, which caused a real, recurring bug pattern (every new category
 * risked colliding with an existing one's keywords). Falls back to
 * keywordClassifier.js automatically on ANY failure - no API key configured,
 * network error, malformed/unparseable response, or an unrecognized
 * category value - so this is never worse than the old system, only better
 * when a real model is actually available.
 */
async function classifyIntent(goal, history = []) {
  try {
    const provider = selectProvider({});
    const categoryList = Object.entries(CATEGORIES)
      .map(([key, desc]) => `- ${key}: ${desc}`)
      .join('\n');
    const exampleList = EXAMPLES.map(([msg, cat]) => `"${msg}" -> ${cat}`).join('\n');

    const result = await provider.complete({
      maxTokens: 120, // generous for a tiny {"category": "..."} response - 60 occasionally clipped the longest category names mid-word, wasting a round-trip before falling back
      system:
        `Classify the user's message into EXACTLY ONE of these categories. Respond with ONLY a JSON ` +
        `object: {"category": "..."} - the value must be exactly one of these strings:\n\n${categoryList}\n\n` +
        `A message that merely MENTIONS a category's topic is not automatically that category - only ` +
        `classify it there if the message is actually REQUESTING that action. "Research X" or "look up X" ` +
        `is almost always "research" - it is NOT "outreach" (which needs an explicit lead-finding/cold-` +
        `email intent) and NOT "ceo" (which needs an explicit strategy/priorities/tradeoff question, not ` +
        `just a topic that could inform one). A request to BUILD a website/app/system is "coding" even if ` +
        `its feature list mentions email, WhatsApp, sharing, contact forms, or marketing - those describe ` +
        `features the built thing should HAVE, not a request to send a message or draft content right now. ` +
        `When genuinely unsure, prefer "conversational" or "research" ` +
        `over guessing a more specific action category.\n\nExamples:\n${exampleList}`,
      prompt: goal,
      history: history.slice(-4), // just enough for follow-up references, not the whole thread
    });

    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`no JSON found in classification response: ${result.text.slice(0, 150)}`);

    const parsed = JSON.parse(match[0]);
    if (!CATEGORIES[parsed.category]) throw new Error(`unrecognized category "${parsed.category}"`);

    console.log(`[intentClassifier] "${goal.slice(0, 60)}" -> ${parsed.category}`);
    return { category: parsed.category, isActionable: parsed.category !== 'conversational', usedFallback: false };
  } catch (err) {
    console.warn(`[intentClassifier] LLM classification failed (${err.message}) - falling back to keyword classification`);
    return fallbackViaKeywords(goal);
  }
}

module.exports = { classifyIntent, CATEGORIES };
