const BaseAgent = require('../base/BaseAgent');
const config = require('../../config');
const toolRegistry = require('../../tools/ToolRegistry');
const activityLog = require('../../core/activityLog');
const { selectProvider } = require('../../core/router');
const { businessContextLine } = require('../../core/businessContext');
const { checkFreshness } = require('../../core/verification/freshness');
const { scoreOpportunity, MAX_POINTS } = require('../../core/verification/scoreOpportunity');
const {
  extractDomainFromUrl,
  extractDomainFromEmail,
  isValidEmailFormat,
  domainsMatch,
} = require('../../core/verification/domainUtils');

/**
 * JobVerificationAgent - Phase 1 of the Verified Job Outreach system.
 *
 * Takes a raw opportunity (company, job listing, optional contact info) and
 * runs it through job / company / contact verification before anything
 * downstream (outreach, scheduling) is allowed to touch it. Nothing here
 * invents a fact: every point on the score is either a deterministic check
 * (dates, domain matching) or backed by an actual web search result. If web
 * search isn't configured, verification degrades honestly to a partial
 * score with a clear reason logged - never silently upgraded to VERIFIED.
 *
 * Scope: this agent verifies a single opportunity and returns a
 * VerificationRecord. It does NOT send outreach, schedule anything, or
 * persist to a database - that's later phases (Outreach + Pipeline,
 * Scheduling). Keeping this boundary tight means every later phase can
 * trust "verified" means verified, without also depending on storage or
 * outreach logic being correct.
 */
class JobVerificationAgent extends BaseAgent {
  constructor() {
    super({
      key: 'job-verification',
      role: 'Job Verification Agent',
      goals: ['Verify job opportunities are genuine, current, and safe to contact before any outreach happens'],
      tools: ['websearch.search'],
    });
  }

  // Standard BaseAgent plan()/execute() (flat instruction -> steps) isn't a
  // good fit here - verification needs structured, conditional logic, not a
  // linear list of LLM calls. `verify()` below is the real entry point.
  // plan/execute are left as BaseAgent's defaults so this agent still
  // behaves sanely if ever invoked generically through the orchestrator.

  /**
   * @param {object} opportunity - see fields referenced below; all optional
   *   except that missing fields honestly reduce the score/trigger review
   *   rather than being assumed present.
   * @returns {Promise<object>} VerificationRecord
   */
  async verify(opportunity = {}) {
    const taskId = opportunity.id || `verify-${Date.now()}`;
    await activityLog.record(this.role, 'task_started', 'verify', {
      taskId,
      company: opportunity.company,
      jobTitle: opportunity.jobTitle,
    });

    const reasons = [];
    let suspicious = false;
    let expired = false;

    // --- 1. Freshness (deterministic, no network) ---
    const freshness = checkFreshness(opportunity.postedDate);
    await activityLog.record(this.role, 'freshness_checked', opportunity.company || '', { taskId, ...freshness });

    let freshnessPoints;
    if (freshness.status === 'FRESH') freshnessPoints = MAX_POINTS.freshness;
    else if (freshness.status === 'ACCEPTABLE') freshnessPoints = Math.round(MAX_POINTS.freshness * 0.6);
    else if (freshness.status === 'POSTING_DATE_UNKNOWN') freshnessPoints = Math.round(MAX_POINTS.freshness * 0.3);
    else freshnessPoints = 0; // STALE

    if (freshness.status === 'STALE') reasons.push(freshness.label);

    // Deadline check - a passed deadline is a hard EXPIRED override,
    // regardless of how well everything else scores.
    if (opportunity.deadline) {
      const deadlineDate = new Date(opportunity.deadline);
      if (!isNaN(deadlineDate.getTime()) && deadlineDate.getTime() < Date.now()) {
        expired = true;
        reasons.push(`Application deadline (${opportunity.deadline}) has passed`);
      }
    }

    // --- 2. Company verification ---
    const companyDomain = extractDomainFromUrl(opportunity.companyWebsite);
    let companyPoints = 0;
    let companyVerified = false;
    let companySearchResults = null;

    if (!opportunity.company) {
      reasons.push('No company name provided - cannot verify');
      suspicious = true;
    } else if (config.search.tavilyKey) {
      try {
        companySearchResults = await toolRegistry.call(
          'websearch.search',
          { query: `"${opportunity.company}" official website careers`, maxResults: 5 },
          { role: this.role }
        );
        await activityLog.record(this.role, 'tool_call', 'websearch.search', { taskId, target: 'company', status: 'done' });

        const results = companySearchResults.results || [];
        const matchesDomain = companyDomain && results.some((r) => domainsMatch(extractDomainFromUrl(r.url), companyDomain));

        if (matchesDomain) {
          companyPoints = MAX_POINTS.company;
          companyVerified = true;
        } else if (results.length > 0) {
          // Company turns up in search but the exact domain wasn't
          // confirmed - partial credit, flagged for human review rather
          // than silently trusted.
          companyPoints = Math.round(MAX_POINTS.company * 0.5);
          reasons.push(`Company "${opportunity.company}" found in search but website domain could not be confirmed - review manually`);
        } else {
          reasons.push(`No search results found for company "${opportunity.company}" - could not confirm it currently operates`);
          suspicious = true;
        }
      } catch (err) {
        reasons.push(`Company verification search failed: ${err.message}`);
      }
    } else {
      reasons.push('No web search configured (TAVILY_API_KEY missing) - company existence could not be verified');
      companyPoints = Math.round(MAX_POINTS.company * 0.3); // honest partial credit, not silently full
    }

    // --- 3. Job listing verification ---
    let jobListingPoints = 0;
    const applicationDomain = extractDomainFromUrl(opportunity.applicationUrl);

    if (!opportunity.jobTitle || !opportunity.applicationUrl) {
      reasons.push('Missing job title or application URL - cannot verify listing');
      suspicious = true;
    } else if (companyDomain && domainsMatch(applicationDomain, companyDomain)) {
      // Strongest signal: application lives on the company's own domain
      // (their own careers page/portal) - matches the spec's source
      // priority list (#1).
      jobListingPoints = MAX_POINTS.jobListing;
    } else if (companySearchResults && (companySearchResults.results || []).some((r) => domainsMatch(extractDomainFromUrl(r.url), applicationDomain))) {
      // Turned up independently in the company search - solid, just not
      // first-party.
      jobListingPoints = Math.round(MAX_POINTS.jobListing * 0.8);
    } else {
      jobListingPoints = Math.round(MAX_POINTS.jobListing * 0.5);
      reasons.push('Application URL is on a third-party domain not independently confirmed - treat as lower-confidence source');
    }

    // --- 4. Contact verification (deterministic - never invents a contact) ---
    let contactStatus = 'UNKNOWN';
    let contactPoints = 0;

    if (!opportunity.contactEmail) {
      contactStatus = 'UNKNOWN';
      reasons.push('No contact email provided - outreach cannot be sent to an unverified/invented contact');
    } else if (!isValidEmailFormat(opportunity.contactEmail)) {
      contactStatus = 'INVALID';
      reasons.push(`Contact email "${opportunity.contactEmail}" is not a valid email format`);
    } else {
      const contactDomain = extractDomainFromEmail(opportunity.contactEmail);
      if (companyDomain && domainsMatch(contactDomain, companyDomain)) {
        contactStatus = 'VERIFIED';
        contactPoints = MAX_POINTS.contact;
      } else {
        contactStatus = 'LIKELY_VALID';
        contactPoints = Math.round(MAX_POINTS.contact * 0.5);
        reasons.push('Contact email domain does not match company website domain - marked LIKELY_VALID, not VERIFIED');
      }
    }

    // --- 5. Relevance (the one genuinely judgment-based category - grounded
    // only in the job description text actually provided, never invented) ---
    let relevancePoints = Math.round(MAX_POINTS.relevance * 0.5); // neutral default
    if (opportunity.jobDescription) {
      try {
        const provider = selectProvider({});
        const result = await provider.complete({
          system: `${businessContextLine()}Rate how relevant this job opportunity is, from 0-15. Respond with ONLY a number, no explanation.`,
          prompt: `Job title: ${opportunity.jobTitle || 'unknown'}\nDescription: ${opportunity.jobDescription}`,
          maxTokens: 10,
        });
        const parsed = parseInt(String(result.text).trim(), 10);
        if (!isNaN(parsed)) relevancePoints = Math.max(0, Math.min(MAX_POINTS.relevance, parsed));
      } catch (err) {
        reasons.push(`Relevance scoring failed, used neutral default: ${err.message}`);
      }
    } else {
      reasons.push('No job description provided - relevance scored as neutral default, not verified');
    }

    // --- 6. Source reliability (deterministic, based on stated source) ---
    const source = (opportunity.source || '').toLowerCase();
    let sourceReliabilityPoints;
    if (source.includes('careers') || (companyDomain && domainsMatch(applicationDomain, companyDomain))) {
      sourceReliabilityPoints = MAX_POINTS.sourceReliability;
    } else if (source.includes('linkedin')) {
      sourceReliabilityPoints = Math.round(MAX_POINTS.sourceReliability * 0.8);
    } else if (source.includes('indeed') || source.includes('glassdoor') || source.includes('job board')) {
      sourceReliabilityPoints = Math.round(MAX_POINTS.sourceReliability * 0.6);
    } else {
      sourceReliabilityPoints = Math.round(MAX_POINTS.sourceReliability * 0.3);
    }

    const points = {
      freshness: freshnessPoints,
      company: companyPoints,
      jobListing: jobListingPoints,
      contact: contactPoints,
      relevance: relevancePoints,
      sourceReliability: sourceReliabilityPoints,
    };

    const scored = scoreOpportunity(points, { expired, suspicious });

    const record = {
      opportunityId: opportunity.id || null,
      company: opportunity.company || null,
      jobTitle: opportunity.jobTitle || null,
      score: scored.score,
      status: scored.status,
      tier: scored.tier,
      breakdown: scored.breakdown,
      freshness,
      companyVerified,
      contactStatus,
      applicationUrlVerified: jobListingPoints >= Math.round(MAX_POINTS.jobListing * 0.8),
      reasons,
      // Only VERIFIED opportunities may proceed to automated outreach, per
      // the spec's rule - LIKELY_CURRENT would need an explicit user
      // opt-in, handled one layer up in Phase 2, not decided in here.
      canProceedToOutreach: scored.status === 'VERIFIED',
      verifiedAt: new Date().toISOString(),
    };

    await activityLog.record(this.role, 'verification_completed', opportunity.company || '', {
      taskId,
      score: record.score,
      status: record.status,
    });

    return record;
  }
}

module.exports = JobVerificationAgent;