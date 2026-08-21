/**
 * Keyword-based classification - the ORIGINAL routing mechanism, kept as a
 * safety-net fallback for when LLM-based classification (intentClassifier.js)
 * is unavailable (no API key, network failure, malformed response). This is
 * what caused a real, recurring class of bugs when it was the primary
 * router: every new category risked colliding with an existing one's
 * keywords (inbox-triage vs a strategy question that merely mentions
 * "inbox", marketing vs email, WhatsApp vs marketing, coding vs GitHub,
 * content-studio vs marketing - all real, separately-discovered collisions).
 * Kept and still tested because it's genuinely useful as a fallback that
 * works without any API call at all.
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

  // Computed early and given priority over whatsapp/outreach/ceo/content-studio
  // below - a real bug this fixes: a long build-a-website spec that happens
  // to mention "WhatsApp" once (e.g. in a "share via WhatsApp" feature list)
  // was previously classified as isWhatsApp before isCoding was even
  // checked, since isCoding was computed much later in the original order.
  // An explicit build-verb + build-noun request ("build...website") is a
  // strong, unambiguous signal that should win over an incidental keyword
  // mention buried elsewhere in a long document, not lose to it.
  const codingVerb = /\b(build|code|scaffold|design)\b/.test(lower);
  const codingNoun = /\b(website|web site|webpage|web page|landing page|page|app|application|system)\b/.test(lower);
  const isCoding = !isInboxTriage && !isSupport && codingVerb && codingNoun;

  const isWhatsApp =
    !isInboxTriage &&
    !isSupport &&
    !isCoding &&
    lower.includes('whatsapp') &&
    (lower.includes('send') || lower.includes('message') || lower.includes('text') || lower.includes('reply'));
  const isOutreach =
    !isInboxTriage &&
    !isSupport &&
    !isCoding &&
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
    !isCoding &&
    !isWhatsApp &&
    !isOutreach &&
    (lower.includes('strategy') ||
      lower.includes('should we') ||
      lower.includes('should i focus') ||
      lower.includes('should i prioritize') ||
      lower.includes('business decision') ||
      lower.includes('roadmap') ||
      lower.includes('pivot'));
  const isContentStudio =
    !isInboxTriage &&
    !isSupport &&
    !isCoding &&
    !isWhatsApp &&
    !isOutreach &&
    !isCEO &&
    (lower.includes('create a campaign') ||
      lower.includes('promote my') ||
      lower.includes('content campaign') ||
      lower.includes('social media campaign') ||
      lower.includes('content studio') ||
      lower.includes('marketing campaign for'));
  const isGithub =
    !isInboxTriage &&
    !isSupport &&
    !isWhatsApp &&
    !isOutreach &&
    !isCEO &&
    !isContentStudio &&
    !isCoding &&
    lower.includes('github') &&
    (lower.includes('create') || lower.includes('repo') || lower.includes('commit') || lower.includes('pull request'));
  const isMarketing =
    !isInboxTriage &&
    !isSupport &&
    !isWhatsApp &&
    !isOutreach &&
    !isCEO &&
    !isContentStudio &&
    !isCoding &&
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
    !isContentStudio &&
    !isCoding &&
    !isGithub &&
    !isMarketing &&
    (lower.includes('email') || lower.includes('send'));
  const isResearch =
    !isInboxTriage &&
    !isSupport &&
    !isWhatsApp &&
    !isOutreach &&
    !isCEO &&
    !isContentStudio &&
    !isCoding &&
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
    isContentStudio,
    isCoding,
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
      isContentStudio ||
      isCoding ||
      isGithub ||
      isMarketing ||
      isEmailSend ||
      isResearch,
  };
}

module.exports = { classify };
