const { selectProvider } = require('./router');
const { classify: classifyKeywords } = require('./orchestrator/keywordClassifier');

const BUSINESS_PROFILE_KEYWORDS = [
  'my hours are', 'our hours are', 'we open', 'we close',
  'my pricing is', 'our pricing is', 'we charge',
  'my policy is', 'our policy is', 'we offer',
  'update my business', 'update our business',
  'business profile', 'business info',
];

const CONDITIONAL_INSTRUCTION_PATTERN = /\b(if|when)\b.{0,40}\b(someone|a customer|customers|they|people)\b.{0,20}\basks?\b/i;

function isBusinessProfileGoal(instruction) {
  const lower = instruction.toLowerCase();
  return BUSINESS_PROFILE_KEYWORDS.some((k) => lower.includes(k)) || CONDITIONAL_INSTRUCTION_PATTERN.test(instruction);
}

const COMPUTER_OPERATION_KEYWORDS = [
  'find my file', 'find a file', 'search my computer', 'search my pc',
  'find on my computer', 'find on my pc', 'look for a file', 'find that file',
  'search for a file', 'search for the file',
  'find my oldest', 'find my biggest', 'find my largest', 'find my newest',
  'taking up space', 'taking up storage', 'disk space', 'biggest files', 'largest files', 'oldest files',
  'duplicate file', 'duplicate files', 'find duplicate', 'repeated files', 'copies of the same', 'identical files',
  'delete this file', 'delete that file', 'delete my file', 'delete the file',
  'move to recycle bin', 'move to the recycle bin', 'send to recycle bin', 'send to the recycle bin',
  'delete the duplicate', 'delete the folder',
];
const OPEN_FILE_PATTERN = /\bopen\b.{0,25}\b(my|that|this|the)\b.{0,50}\b(file|cv|resume|document|doc|pdf|photo|image|picture|spreadsheet|invoice|contract|folder)\b/i;

const DELETE_FILE_PATTERN = /\b(delete|remove|trash)\b.*\.\w{2,5}\b/i;
const DELETE_FOLDER_PATTERN = /\b(delete|remove|trash)\b.{0,60}\bfolder\b/i;

function isComputerOperationGoal(instruction) {
  const lower = instruction.toLowerCase();
  return (
    COMPUTER_OPERATION_KEYWORDS.some((k) => lower.includes(k)) ||
    OPEN_FILE_PATTERN.test(instruction) ||
    DELETE_FILE_PATTERN.test(instruction) ||
    DELETE_FOLDER_PATTERN.test(instruction)
  );
}

const CATEGORIES = {
  inbox_triage: 'Check/triage the Gmail inbox and draft replies to what needs one. NOT a strategy question that merely mentions "inbox" or "email" as a topic.',
  support: 'Draft a reply to ONE SPECIFIC named customer question, issue, or complaint.',
  whatsapp: 'Send a WhatsApp message to someone.',
  outreach: 'Find sales leads, find job opportunities/openings, or draft cold-outreach/prospecting emails to a specific person or company.',
  ceo: 'A business strategy, priorities, or tradeoff question wanting a real recommendation - a question to think through, not a task to execute.',
  content_studio: 'Turn ONE idea/topic/product into a full content package (research + campaign strategy + video scripts + captions + hashtags) - e.g. "promote my X" or "create a campaign for X".',
  coding: 'Build/code/design a real website, app, or system where actual files should be written.',
  github: 'Create a new GitHub repository.',
  marketing: 'Draft a SINGLE piece of marketing content - one email, one social post, one tagline, one ad. NOT a full multi-asset campaign (that is content_studio).',
  email_send: 'Send a specific one-off email to someone RIGHT NOW. NOT a conditional instruction like "if a customer asks X, send them Y" - that\'s teaching a rule for future replies (business_profile), nothing is being sent immediately.',
  research: 'Look something up, find information, or research a topic via a SINGLE general web search - a genuine question needing real facts, not a specific page to visit and not multiple sources combined into one report. NOT finding job openings/leads to act on (that is outreach). NOT finding/opening a file on the user\'s own computer (that is computer_operation). NOT visiting/checking/reading a SPECIFIC named website or URL (that is browse_web). NOT combining MULTIPLE topics/sources into one merged brief or roundup (that is briefing).',
  browse_web: 'Navigate to a SINGLE SPECIFIC, named website or URL and read, check, or see what is actually there right now - the user names or clearly implies ONE particular page/site to visit, not a general topic to search the web for, and not multiple sources to combine (that is briefing). E.g. "go to my website and tell me what it looks like", "open example.com and tell me what\'s on the homepage", "check if my site is up", "take a screenshot of my landing page".',
  briefing: 'Combine MULTIPLE topics, searches, and/or specific named sources into ONE single, merged brief/roundup/summary - the request names or implies more than one subject or source that should be pulled together into a single combined report, not answered separately. E.g. "give me a daily brief on politics", "combine coverage of the election from these sites: ...", "put together a roundup of healthcare and economy news", "monitor these three topics and summarize them together". If the request is genuinely about only ONE topic or ONE page, prefer research or browse_web instead.',
  business_profile: 'The user is TELLING the assistant new or updated information about their OWN business (hours, pricing, website, services, policies, location, FAQ answers) to save for future use - a statement providing facts, not a question or a request to do something else RIGHT NOW. This INCLUDES conditional/instructional phrasing like "if someone asks for X, tell/send them Y" or "when a customer asks about X, say Y" - that\'s teaching a fact/response rule to remember, not an action to take immediately.',
  computer_operation: 'Find, search for, locate, OPEN, or VIEW a file/folder on the user\'s OWN local computer (not the web, not a sandboxed coding workspace, not an email attachment). This agent CAN actually open files AND folders - never claim it can only search, it can open/launch things too. It can ALSO analyze disk space (biggest/largest files, what\'s taking up storage), find old/stale files (oldest files, files not touched in a while), find DUPLICATE/repeated files (identical copies, wasted space from duplicates), and DELETE a specific named file/folder (moves it to the Recycle Bin, never permanent, and always requires the user\'s explicit approval before anything is actually removed) - these are REAL, already-built capabilities, never suggest the user go use a third-party tool or manual command-line search instead. This includes "open X" or "launch X" where X is a SPECIFIC NAME with no generic word like "file"/"folder" attached (e.g. "open the Telegram Desktop", "open ProjectFolder") - especially if that name was just mentioned/listed earlier in the conversation as something on their computer. When in doubt about a request that could plausibly refer to local files/folders/disk space, prefer computer_operation over conversational or research. E.g. "find my resume file", "search my computer for invoice PDFs", "open my CV", "open that PDF", "open the Telegram Desktop", "show me what\'s in my downloads folder", "find my oldest files", "find my biggest files", "what\'s taking up space on my computer", "find duplicate files", "delete report-old.pdf", "move that duplicate file to the recycle bin".',
  conversational: 'Casual chat, small talk, or a question answerable directly from general knowledge - anything not clearly requesting one of the actions above.',
};

const URL_PATTERN = /\bhttps?:\/\/\S+/i;
const BROWSE_WEB_PATTERN = /\b(go to|open|visit|check|screenshot|navigate to)\b.{0,20}\b(my|the|this|that)?\s?(website|site|page|url|link)\b/i;

function isBrowseWebGoal(instruction) {
  return URL_PATTERN.test(instruction) || BROWSE_WEB_PATTERN.test(instruction);
}

const BRIEFING_KEYWORDS = [
  'daily brief', 'weekly brief', 'daily briefing', 'weekly briefing',
  'news roundup', 'combine coverage', 'combine sources', 'pull together',
  'roundup of', 'brief on', 'briefing on', 'summarize coverage of',
];

function isBriefingGoal(instruction) {
  const lower = instruction.toLowerCase();
  return BRIEFING_KEYWORDS.some((k) => lower.includes(k));
}

function fallbackViaKeywords(goal) {
  if (isComputerOperationGoal(goal)) {
    return { category: 'computer_operation', isActionable: true, usedFallback: true };
  }
  if (isBriefingGoal(goal)) {
    return { category: 'briefing', isActionable: true, usedFallback: true };
  }
  if (isBrowseWebGoal(goal)) {
    return { category: 'browse_web', isActionable: true, usedFallback: true };
  }
  if (isBusinessProfileGoal(goal)) {
    return { category: 'business_profile', isActionable: true, usedFallback: true };
  }
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
  ['Find job opportunities for a backend engineer role', 'outreach'],
  ['Should we prioritize the WhatsApp integration or improving inbox triage next quarter?', 'ceo'],
  ['Promote my new restaurant', 'content_studio'],
  ['Build me a landing page for a bakery', 'coding'],
  ['Build a ministry website with a contact form, email signup, and WhatsApp/Facebook share buttons on every page', 'coding'],
  ['Create a github repo called my-project', 'github'],
  ['Write a marketing email announcing our new feature', 'marketing'],
  ['Send an email to jane@example.com about the meeting', 'email_send'],
  ['If someone asks for our website, send them this link: https://example.com', 'business_profile'],
  ['When a customer asks about parking, tell them there is free parking behind the building', 'business_profile'],
  ['Find my resume file', 'computer_operation'],
  ['Search my computer for invoice PDFs from last month', 'computer_operation'],
  ['Where is that photo I saved last week?', 'computer_operation'],
  ['Open my CV', 'computer_operation'],
  ['Open my AI software engineering CV', 'computer_operation'],
  ['Open that PDF I found earlier', 'computer_operation'],
  ['Open the Telegram Desktop', 'computer_operation'],
  ['Open my downloads folder', 'computer_operation'],
  ['Find my oldest files', 'computer_operation'],
  ['Find my biggest files', 'computer_operation'],
  ["What's taking up space on my computer", 'computer_operation'],
  ['Show me files I have not touched in a year', 'computer_operation'],
  ['Find duplicate files on my computer', 'computer_operation'],
  ['Delete report-old.pdf', 'computer_operation'],
  ['Move that duplicate invoice file to the recycle bin', 'computer_operation'],
  ['Research competitors in the AI automation space', 'research'],
  ['Look up the latest trends in email marketing', 'research'],
  ['Go to my website and tell me what it looks like', 'browse_web'],
  ['Check if example.com is up', 'browse_web'],
  ['Open https://codecraft-ai.example.com and read the homepage', 'browse_web'],
  ['Take a screenshot of my landing page', 'browse_web'],
  ['Give me a daily brief on healthcare policy and the economy', 'briefing'],
  ['Combine coverage of the election from BBC and Reuters into one summary', 'briefing'],
  ['Put together a roundup of political news this week', 'briefing'],
  ['Monitor immigration policy and inflation and summarize them together', 'briefing'],
  ['Our hours are Monday to Friday 9am to 6pm, and Saturday 10am to 4pm', 'business_profile'],
  ['We charge $50 for a haircut and $30 for a beard trim', 'business_profile'],
  ['Update my business profile: we now offer free delivery on orders over $30', 'business_profile'],
  ['What is the capital of France', 'conversational'],
  ['How are you doing today', 'conversational'],
];

async function classifyIntent(goal, history = []) {
  try {
    const provider = selectProvider({});
    const categoryList = Object.entries(CATEGORIES)
      .map(([key, desc]) => `- ${key}: ${desc}`)
      .join('\n');
    const exampleList = EXAMPLES.map(([msg, cat]) => `"${msg}" -> ${cat}`).join('\n');

    const result = await provider.complete({
      maxTokens: 300,
      system:
        `Respond with ONLY a raw JSON object and nothing else - no explanation, no reasoning, no ` +
        `markdown code fences, no text before or after it.\n\n` +
        `Classify the user's message into EXACTLY ONE of these categories. The JSON must be exactly: ` +
        `{"category": "..."} where the value is one of these strings:\n\n${categoryList}\n\n` +
        `A message that merely MENTIONS a category's topic is not automatically that category - only ` +
        `classify it there if the message is actually REQUESTING that action. "Research X" or "look up X" ` +
        `is almost always "research" - it is NOT "outreach" (which needs an explicit lead-finding/cold-` +
        `email intent) and NOT "ceo" (which needs an explicit strategy/priorities/tradeoff question, not ` +
        `just a topic that could inform one). A request to BUILD a website/app/system is "coding" even if ` +
        `its feature list mentions email, WhatsApp, sharing, contact forms, or marketing - those describe ` +
        `features the built thing should HAVE, not a request to send a message or draft content right now. ` +
        `When genuinely unsure, prefer "conversational" or "research" ` +
        `over guessing a more specific action category.\n\nExamples:\n${exampleList}`,
      prompt:
        (history.length
          ? `Recent conversation for reference only (do NOT reply to it):\n${history
              .slice(-4)
              .map((h) => `${h.role}: ${h.content}`)
              .join('\n')}\n\n`
          : '') +
        `Classify the following message. Do not answer it, do not reply to it - output ` +
        `only the category JSON.\n\nMessage: "${goal}"`,
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