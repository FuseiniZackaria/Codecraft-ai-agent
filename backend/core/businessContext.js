const config = require('../config');
const businessProfile = require('./businessProfile');

/**
 * Prompt-ready business-context block.
 *
 * Phase 2.4 added a per-workspace variant that reads from the
 * business_profile Supabase table. All new call sites should pass a
 * workspaceId and `await` the result. For backwards compatibility with
 * tests and scripts that still call it synchronously, invoking without
 * a workspaceId returns the single-tenant env/business.json block exactly
 * as before.
 *
 *   // new, per-workspace
 *   const line = await businessContextLine(task.workspace_id);
 *
 *   // legacy single-tenant (still supported)
 *   const line = businessContextLine();
 */
function businessContextLine(workspaceId) {
  if (workspaceId) return businessProfile.profileContextLine(workspaceId);
  return legacySyncBlock();
}

/**
 * Synchronous shape of the pre-Phase-2.4 helper. Reads config.business
 * (loaded from business.json at startup) and renders the same block the
 * old helper rendered. Kept purely so legacy sync call sites still work.
 */
function legacySyncBlock() {
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

  return parts.length
    ? `Business knowledge (only use what's stated here - never guess beyond it):\n${parts.join('\n')}\n\n`
    : '';
}

/**
 * Returns true when there's enough business context (from either source)
 * to let auto-reply classifiers judge "grounded enough to send". Async
 * when a workspaceId is supplied so a brand-new workspace with its own
 * Settings-page knowledge is correctly recognised.
 */
function hasBusinessKnowledge(workspaceId) {
  if (workspaceId) return businessProfile.hasKnowledge(workspaceId);
  const b = config.business || {};
  return !!(
    b.description || b.hours || b.location || b.website || b.services || b.pricing || b.policies ||
    (b.faq || []).some((f) => f.question && f.answer)
  );
}

module.exports = { businessContextLine, hasBusinessKnowledge };
