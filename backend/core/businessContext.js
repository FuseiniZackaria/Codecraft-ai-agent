const config = require('../config');

/**
 * Builds the block of text every drafting/classification prompt in this
 * codebase prefixes onto its system message. Only includes fields that are
 * actually filled in - an empty business.json produces an empty string,
 * so nothing breaks for someone who hasn't configured this yet.
 */
function businessContextLine() {
  const b = config.business || {};
  const parts = [];
  if (b.companyName) parts.push(`Company: ${b.companyName}`);
  if (b.industry) parts.push(`Industry: ${b.industry}`);
  if (b.targetMarket) parts.push(`Target market: ${b.targetMarket}`);
  if (b.description) parts.push(`Description: ${b.description}`);
  if (b.knownCompetitors?.length) parts.push(`Known competitors: ${b.knownCompetitors.join(', ')}`);
  if (b.hours) parts.push(`Hours: ${b.hours}`);
  if (b.location) parts.push(`Location: ${b.location}`);
  if (b.website) parts.push(`Website: ${b.website}`);
  if (b.services) parts.push(`Services: ${b.services}`);
  if (b.pricing) parts.push(`Pricing: ${b.pricing}`);
  if (b.policies) parts.push(`Policies: ${b.policies}`);

  const faqEntries = (b.faq || []).filter((f) => f.question && f.answer);
  if (faqEntries.length) {
    parts.push(`FAQ:\n${faqEntries.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n')}`);
  }

  return parts.length ? `Business knowledge (only use what's stated here - never guess beyond it):\n${parts.join('\n')}\n\n` : '';
}

/**
 * The raw knowledge object itself, for callers (like the auto-reply safety
 * classifier) that need to reason about whether the knowledge base is
 * substantial enough to cover a given question, not just render it as text.
 */
function hasBusinessKnowledge() {
  const b = config.business || {};
  return !!(
    b.description || b.hours || b.location || b.website || b.services || b.pricing || b.policies ||
    (b.faq || []).some((f) => f.question && f.answer)
  );
}

module.exports = { businessContextLine, hasBusinessKnowledge };