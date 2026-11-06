const { RISK_KEYWORDS, containsPlaceholderText } = require('../autoReplySafety');

/**
 * Decides whether a drafted WhatsApp reply can go out on its own (the owner
 * gets an FYI) or must wait for the owner's approval (the customer gets the
 * "let me check with the team" reply instead).
 *
 * Held for approval ONLY for: pricing or quotes, agreeing to a deal, deadlines
 * or promises, complaints / upset customers / sensitive topics, or when the AI
 * doesn't know. Plus the safety nets that protect a real customer: a reply
 * claiming to be the founder, placeholder text, or a contact detail / link the
 * business never gave. Deterministic checks run alongside the AI's own "hold"
 * flag, so one missed judgement can't send a price or a promise.
 */

/*
 * Payments are NEVER confirmed automatically - not from a text ("I've sent the
 * MoMo") and not from a screenshot. A person checks the money actually arrived.
 * The customer is told a team member will confirm, and the owner is alerted.
 */
const MONEY = '(money|payment|momo|mobile money|cash|amount|fees?|deposit|balance|transfer)';
const PAYMENT_CLAIM_RE = new RegExp(
  "\\b(i('ve| have)?( just| already| now)? (paid|transferred|made (the |my |a )?payment|sent (you |it |the |my )*" + MONEY + ')' +
  `|(sent|send|did|made) (the |a |my )?(momo|mobile money|bank transfer|transfer)` +
  `|payment (is |was |has been )?(done|made|sent|successful|completed|through)` +
  `|proof of payment|payment (receipt|screenshot|confirmation|slip)|transaction (id|reference|ref|number)|momo (receipt|reference|ref)` +
  `|(confirm|check|verify) (my|the) (payment|transfer|momo)|(have|did) you (receive|received|get|got|see|seen) (my|the) ${MONEY})\\b`,
  'i',
);
const PAYMENT_CONFIRM_RE = new RegExp(
  `\\b((we|i)('ve| have)?( now| just)? (received|got|confirmed|verified) (your|the) ${MONEY}` +
  `|${MONEY} (has been |have been |is |was |has |have )?(now )?(received|confirmed|successful|verified|gone through|come through|reflected|arrived|cleared))\\b`,
  'i',
);
const PAYMENT_REASON = 'payment - never confirmed automatically (a person must check the money arrived)';

/** True if the customer is telling us they've paid / sending proof of payment. */
function isPaymentClaim(text) {
  return PAYMENT_CLAIM_RE.test(String(text || ''));
}

const INCOMING_RULES = [
  {
    reason: 'pricing or a quote',
    // "cost"/"charge" only when it's about what CodeCraft charges ("AI can cut costs" is a general question).
    re: /\b(price|prices|pricing|how much|quote|quotation|fee|fees|rate card|your rates|budget|invoice|deposit|discount|cedi|cedis|ghs|(does|will|would|did) (it|this|that) cost|the cost of (your|this|that|the)|your charges|(do|would|will) you charge|what do you charge)\b|gh₵|₵/i,
  },
  {
    reason: 'agreeing to a deal',
    // Not plain "deal" ("AI to deal with customers" is a general question).
    re: /\b(it'?s a deal|we have a deal|close the deal|the deal|contract|sign up|let'?s (proceed|go ahead|start|do it)|go ahead with|i accept|accept (the|your) offer|i want to hire|hire (you|your team))\b/i,
  },
  {
    reason: 'a deadline or promise',
    re: /\b(deadline|due date|delivery date|by (tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|end of)|how long (will|would) (it|you|this|that) take|when (will|can|would) (it|you|this|that) (be ready|be done|deliver|finish)|guarantee|guaranteed|promise|asap|urgent|urgently)\b/i,
  },
];

const DRAFT_RULES = [
  { reason: 'the reply mentions a price', re: /(gh₵|₵|\bghs|\busd|\$|€|£)\s?\d|\b\d[\d,.]*\s?(cedis?|ghs|dollars|usd)\b/i },
  { reason: 'the reply makes a promise or agrees a deal', re: /\b(i promise|we promise|we guarantee|guaranteed|it'?s a deal|we have a deal|deal is done)\b/i },
  // A delivery/ready time is a promise; a delivery AREA ("we deliver within Accra") is not.
  { reason: 'the reply makes a promise or agrees a deal', re: new RegExp(`\\b(will be (ready|done|delivered|finished)|deliver (it |this |that |them )?)\\s*(by|in|within)\\s+${'(\\d|an? |one|two|three|four|five|six|seven|few|couple|tomorrow|today|tonight|next|the end|end of|this (week|weekend|month|evening|afternoon)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hours?|days?|weeks?)'}`, 'i') },
];

// Word-boundary match, so "issue" doesn't count as "sue".
const RISK_RE = new RegExp(`\\b(${RISK_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
const UPSET_RE = /\b(not happy|very disappointed|disappointed|rubbish|nonsense|waste of (my )?(time|money)|ripped off|useless|annoyed|frustrated)\b|!{3,}/i;

const FOUNDER_CLAIM_RE = /\b(i am|i'm|im|this is|it's|it is)\s+(the\s+|your\s+)?(founder|co-?founder|owner|ceo|md|managing director|boss)\b|\bi\s+(co-?)?founded\b|\b(i|we)\s+(founded|own)\s+(this|the|our)\s+(business|company)\b/i;
// Case-sensitive on purpose: only a Capitalised word after "I'm" counts as a name ("I'm glad" doesn't).
const NAME_CLAIM_RE = /\b(?:[Mm]y name is|[Mm]y name's|[Tt]his is|I am|I'm)\s+([A-Z][a-zA-Z'-]+)/g;
const NOT_NAMES = new Set(['Sorry', 'Happy', 'Glad', 'Here', 'Just', 'Not', 'So', 'Still', 'Really', 'Afraid', 'An', 'A', 'The', 'Your', 'Great']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Why this draft misrepresents who's speaking, or null. The agent never claims
 * to be the founder/owner or uses any name but its own (agentName, default Ian);
 * the business's own name ("This is CodeCraft") is fine.
 */
function identityProblem(draft, { ownerName = null, agentName = 'Ian', businessName = null } = {}) {
  const text = String(draft || '');
  const agent = String(agentName || 'Ian').trim();
  if (FOUNDER_CLAIM_RE.test(text)) return 'the reply claims to be the founder or owner';
  if (businessName && new RegExp(`\\b(i|we)\\s+(founded|own)\\s+${escapeRe(String(businessName).trim())}\\b`, 'i').test(text)) {
    return 'the reply claims to be the founder or owner';
  }
  const agentLower = new Set(agent.toLowerCase().split(/\s+/));
  // Business name words match loosely: "CodeCraft" is fine for a business saved as "codecraftgh".
  const bizWords = String(businessName || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const isBusiness = (n) => n.length >= 4 && bizWords.some((w) => w.startsWith(n) || n.startsWith(w));
  for (const m of text.matchAll(NAME_CLAIM_RE)) {
    // "I'm Zackman's assistant" / "I'm CodeCraft's assistant" is about whose assistant it is, not a name.
    if (/^[A-Za-z'-]+['’]s$/.test(m[1]) || /^['’]s\b/.test(text.slice(m.index + m[0].length))) continue;
    const name = m[1];
    const lower = name.toLowerCase();
    if (!NOT_NAMES.has(name) && !agentLower.has(lower) && !isBusiness(lower)) return `the reply introduces itself as "${name}" instead of ${agent}`;
  }
  // The account owner's own name (e.g. a profile display name) must never be used as the agent's.
  const agentWords = new Set(agent.toLowerCase().split(/\s+/));
  for (const part of String(ownerName || '').split(/\s+/)) {
    if (part.length >= 3 && !agentWords.has(part.toLowerCase()) && !String(businessName || '').toLowerCase().split(/[^a-z0-9]+/).includes(part.toLowerCase()) && new RegExp(`\\b${escapeRe(part)}\\b`, 'i').test(text)) {
      return `the reply uses the name "${part}"`;
    }
  }
  return null;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)]+|\b[a-z0-9-]+\.(?:com|net|org|io|tech|gh|co|app|dev|ai)(?:\/[^\s)]*)?\b/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE_RE = /\+?\d[\d\s-]{7,}\d/g;

/** A link, email or phone number in the draft that the business knowledge never gave. */
function unverifiedDetail(draft, knowledge = '') {
  const text = String(draft || '');
  const known = String(knowledge || '').toLowerCase();
  const knownDigits = known.replace(/\D/g, '');
  for (const email of text.match(EMAIL_RE) || []) {
    if (!known.includes(email.toLowerCase())) return `an email address (${email}) that isn't in the business info`;
  }
  const withoutEmails = text.replace(EMAIL_RE, ' ');
  for (const url of withoutEmails.match(URL_RE) || []) {
    const bare = url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/.,!?]+$/, '');
    if (!known.includes(bare)) return `a link (${url}) that isn't in the business info`;
  }
  for (const phone of text.match(PHONE_RE) || []) {
    const digits = phone.replace(/\D/g, '');
    const local = digits.replace(/^233/, '').replace(/^0/, '');
    if (!knownDigits.includes(local)) return `a phone number (${phone.trim()}) that isn't in the business info`;
  }
  // Opening hours and other clock times: every time in the reply must appear in the knowledge.
  const knownTimes = timesIn(known);
  for (const t of timesInWithText(text)) {
    if (!knownTimes.has(t.minutes)) return `a time (${t.text.trim()}) that isn't in the business info`;
  }
  return null;
}

// "8am", "6 pm", "5:30pm", "8.30 a.m.", "18:00", "noon", "midnight" -> minutes after midnight.
const TIME_RE = /\b(\d{1,2})(?:[:.](\d{2}))?\s?(a\.?m\.?|p\.?m\.?)(?![a-z])|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(noon|midday|midnight)\b/gi;

function timesInWithText(text) {
  const out = [];
  for (const m of String(text || '').matchAll(TIME_RE)) {
    let minutes;
    if (m[6]) {
      minutes = /midnight/i.test(m[6]) ? 0 : 12 * 60;
    } else if (m[3]) {
      let h = Number(m[1]) % 12;
      if (/p/i.test(m[3])) h += 12;
      if (Number(m[1]) > 12) continue; // "14pm" isn't a time
      minutes = h * 60 + Number(m[2] || 0);
    } else {
      minutes = Number(m[4]) * 60 + Number(m[5]);
    }
    out.push({ minutes, text: m[0].replace(/\.$/, '') });
  }
  return out;
}

function timesIn(text) {
  return new Set(timesInWithText(text).map((t) => t.minutes));
}

/**
 * The model answers with JSON: {"reply": "...", "hold": false, "reason": ""}.
 * Anything else is held (fails closed) - we can't tell whether it meant to hold.
 */
function parseDraft(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const json = JSON.parse(match[0]);
      if (typeof json.reply === 'string') {
        return {
          reply: json.reply,
          hold: json.hold === true || json.hold === 'true',
          reason: String(json.reason || '').trim(),
          // Labels of the knowledge it used, e.g. ["Q2", "D1"] (shown in the Test chat).
          sources: Array.isArray(json.sources)
            ? [...new Set(json.sources.map((s) => String(s).trim().replace(/^\[|\]$/g, '').toUpperCase()).filter((s) => /^[QD]\d{1,3}$/.test(s)))]
            : [],
          parsed: true,
        };
      }
    } catch { /* fall through */ }
  }
  return { reply: raw, hold: true, reason: "the AI's answer wasn't in the expected format", sources: [], parsed: false };
}

const SIGN_OFF_RE = /^\s*((best|kind|warm|warmest|with)\s+)?(regards|wishes)\s*,?\s*$|^\s*(sincerely|cheers|thanks|thank you|many thanks|yours (truly|faithfully|sincerely))\s*,\s*$|^\s*[-—–]{1,2}\s*\S/i;

/**
 * Tidy a drafted reply for WhatsApp: no quotes or "Ian:" label, no email-style
 * sign-off or signature block (the business profile's signature included).
 * The voice file's Signature section, if filled in, is added back on purpose.
 */
function cleanReply(text, { signature = '', profileSignature = '', agentName = 'Ian' } = {}) {
  let t = String(text || '').trim()
    .replace(/^["“']+|["”']+$/g, '')
    .replace(new RegExp(`^(ian|reply|${escapeRe(String(agentName || 'Ian'))})\\s*:\\s*`, 'i'), '')
    .trim();

  // The business profile's email signature, if the model copied it in as a block
  // (on its own line - a name inside a sentence is left for the identity check).
  const sigFirstLine = String(profileSignature || '').split('\n').map((l) => l.trim()).find(Boolean);
  if (sigFirstLine && sigFirstLine.length >= 3) {
    const at = t.split('\n').findIndex((line, i) => i > 0 && line.trim() === sigFirstLine);
    if (at > 0) t = t.split('\n').slice(0, at).join('\n').trim();
  }

  const lines = t.split('\n');
  for (let i = Math.max(1, lines.length - 5); i < lines.length; i += 1) {
    if (SIGN_OFF_RE.test(lines[i])) {
      lines.length = i;
      break;
    }
  }
  t = lines.join('\n').trim();
  if (String(signature || '').trim()) t = `${t}\n\n${signature.trim()}`;
  return t;
}

/**
 * @returns {{ hold: boolean, reason: string }} hold = wait for the owner's approval.
 */
function decideRouting({ incoming, draft, modelHold = false, modelReason = '', knowledge = '', ownerName = null, agentName = 'Ian', businessName = null }) {
  const msg = String(incoming || '');
  // Payments first: whatever else is in the message, a payment is never confirmed by the agent.
  if (isPaymentClaim(msg) || PAYMENT_CONFIRM_RE.test(String(draft || ''))) {
    return { hold: true, reason: PAYMENT_REASON, kind: 'payment' };
  }
  if (!String(draft || '').trim()) return { hold: true, reason: 'no reply was drafted' };

  for (const rule of INCOMING_RULES) {
    if (rule.re.test(msg)) return { hold: true, reason: `the customer is asking about ${rule.reason}` };
  }
  const risk = msg.match(RISK_RE);
  if (risk) return { hold: true, reason: `a complaint or sensitive topic ("${risk[1].toLowerCase()}")` };
  if (UPSET_RE.test(msg)) return { hold: true, reason: 'the customer sounds upset' };

  if (modelHold) return { hold: true, reason: modelReason || 'the AI was not sure how to answer' };

  const identity = identityProblem(draft, { ownerName, agentName, businessName });
  if (identity) return { hold: true, reason: identity };
  for (const rule of DRAFT_RULES) {
    if (rule.re.test(draft)) return { hold: true, reason: rule.reason };
  }
  const draftRisk = String(draft).match(RISK_RE);
  if (draftRisk) return { hold: true, reason: `the reply touches a sensitive topic ("${draftRisk[1].toLowerCase()}")` };
  const placeholder = containsPlaceholderText(draft);
  if (placeholder) return { hold: true, reason: 'the reply contains placeholder text' };
  const detail = unverifiedDetail(draft, knowledge);
  if (detail) return { hold: true, reason: `the reply includes ${detail}` };

  return { hold: false, reason: 'general question - answered straight away' };
}

module.exports = { decideRouting, cleanReply, parseDraft, identityProblem, unverifiedDetail, isPaymentClaim, PAYMENT_REASON };
