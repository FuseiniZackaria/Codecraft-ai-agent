const assert = require('assert');

process.env.TAVILY_API_KEY = 'test-tavily-key';

const { checkFreshness } = require('../core/verification/freshness');
const { scoreOpportunity, MAX_POINTS } = require('../core/verification/scoreOpportunity');
const { extractDomainFromUrl, extractDomainFromEmail, isValidEmailFormat, domainsMatch } = require('../core/verification/domainUtils');
const toolRegistry = require('../tools/ToolRegistry');
const { loadPlugins } = require('../core/pluginLoader');
const mockProvider = require('../core/providers/mockProvider');
const aiProvider = require('../core/providers/aiProvider');
const { selectProvider } = require('../core/router');

// Patches BOTH providers, not just mockProvider. core/router.js's
// selectProvider() picks the real 'ai' provider over 'mock' whenever a real
// API key is configured - so a stub touching only mockProvider silently
// does nothing in any environment with real credentials set, and the test
// ends up hitting a real, non-deterministic LLM call instead of the fixture.
function stubProvider(text) {
  const respond = async () => ({ text, provider: 'mock', costEstimate: 0 });
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = respond;
  aiProvider.complete = respond;
  return () => {
    mockProvider.complete = originalMock;
    aiProvider.complete = originalAi;
  };
}

function stubWebSearch(fn) {
  const original = toolRegistry.tools.get('websearch.search');
  toolRegistry.register('websearch.search', { permission: 'websearch.search', irreversible: false, run: fn });
  return () => {
    if (original) toolRegistry.register('websearch.search', original);
  };
}

async function main() {
  loadPlugins();

  // --- freshness.js ---
  const now = new Date('2026-08-21T00:00:00Z');

  const fresh = checkFreshness('2026-08-15T00:00:00Z', {}, now);
  assert.strictEqual(fresh.status, 'FRESH');
  assert.strictEqual(fresh.daysOld, 6);
  console.log('✓ freshness: recent posting classified FRESH');

  const acceptable = checkFreshness('2026-07-30T00:00:00Z', {}, now);
  assert.strictEqual(acceptable.status, 'ACCEPTABLE');
  console.log('✓ freshness: posting within 30 days but past strong window classified ACCEPTABLE');

  const stale = checkFreshness('2026-01-01T00:00:00Z', {}, now);
  assert.strictEqual(stale.status, 'STALE');
  console.log('✓ freshness: posting older than 30 days classified STALE');

  const unknown = checkFreshness(null, {}, now);
  assert.strictEqual(unknown.status, 'POSTING_DATE_UNKNOWN');
  const unknown2 = checkFreshness(undefined, {}, now);
  assert.strictEqual(unknown2.status, 'POSTING_DATE_UNKNOWN');
  console.log('✓ freshness: missing date never silently assumed current - POSTING_DATE_UNKNOWN');

  const future = checkFreshness('2099-01-01T00:00:00Z', {}, now);
  assert.strictEqual(future.status, 'POSTING_DATE_UNKNOWN');
  console.log('✓ freshness: future-dated posting flagged rather than trusted');

  // --- domainUtils.js ---
  assert.strictEqual(extractDomainFromUrl('https://www.acmecorp.com/careers'), 'acmecorp.com');
  assert.strictEqual(extractDomainFromUrl('acmecorp.com'), 'acmecorp.com');
  assert.strictEqual(extractDomainFromUrl(null), null);
  assert.strictEqual(extractDomainFromUrl('not a url'), null);
  console.log('✓ domainUtils: extractDomainFromUrl normalizes www and handles bad input');

  assert.strictEqual(extractDomainFromEmail('jane@acmecorp.com'), 'acmecorp.com');
  assert.strictEqual(extractDomainFromEmail(null), null);
  console.log('✓ domainUtils: extractDomainFromEmail parses correctly');

  assert.strictEqual(isValidEmailFormat('jane@acmecorp.com'), true);
  assert.strictEqual(isValidEmailFormat('not-an-email'), false);
  assert.strictEqual(isValidEmailFormat(''), false);
  console.log('✓ domainUtils: isValidEmailFormat correctly validates/rejects');

  assert.strictEqual(domainsMatch('acmecorp.com', 'ACMECORP.com'), true);
  assert.strictEqual(domainsMatch('acmecorp.com', 'other.com'), false);
  assert.strictEqual(domainsMatch(null, 'acmecorp.com'), false);
  console.log('✓ domainUtils: domainsMatch is case-insensitive and null-safe');

  // --- scoreOpportunity.js ---
  const perfect = scoreOpportunity({
    freshness: 20, company: 20, jobListing: 25, contact: 15, relevance: 15, sourceReliability: 5,
  });
  assert.strictEqual(perfect.score, 100);
  assert.strictEqual(perfect.status, 'VERIFIED');
  assert.strictEqual(perfect.tier, 'Highly verified');
  console.log('✓ scoreOpportunity: full points across all categories -> 100, Highly verified');

  const lowScore = scoreOpportunity({ freshness: 5, company: 5, jobListing: 5, contact: 0, relevance: 5, sourceReliability: 1 });
  assert.strictEqual(lowScore.status, 'NEEDS_REVIEW');
  assert.strictEqual(lowScore.tier, 'Do not contact');
  console.log('✓ scoreOpportunity: low score -> NEEDS_REVIEW / Do not contact');

  const overridden = scoreOpportunity(
    { freshness: 20, company: 20, jobListing: 25, contact: 15, relevance: 15, sourceReliability: 5 },
    { expired: true }
  );
  assert.strictEqual(overridden.status, 'EXPIRED');
  assert.strictEqual(overridden.score, 0);
  console.log('✓ scoreOpportunity: expired override wins even with a perfect underlying score');

  const suspiciousOverride = scoreOpportunity({ freshness: 20, company: 20, jobListing: 25, contact: 15, relevance: 15, sourceReliability: 5 }, { suspicious: true });
  assert.strictEqual(suspiciousOverride.status, 'SUSPICIOUS');
  console.log('✓ scoreOpportunity: suspicious override wins over a perfect score');

  const clamped = scoreOpportunity({ freshness: 999, company: -50 });
  assert.strictEqual(clamped.breakdown.freshness, MAX_POINTS.freshness);
  assert.strictEqual(clamped.breakdown.company, 0);
  console.log('✓ scoreOpportunity: out-of-range inputs are clamped to valid point ranges');

  // --- JobVerificationAgent integration ---
  const JobVerificationAgent = require('../agents/job-verification/JobVerificationAgent');
  const agent = new JobVerificationAgent();

  // Case 1: strong opportunity - company domain matches, application URL on
  // company's own domain, contact email matches domain, posted recently.
  let restoreSearch = stubWebSearch(async () => ({
    answer: null,
    results: [{ title: 'Acme Corp Careers', url: 'https://www.acmecorp.com/careers', content: 'We are hiring' }],
  }));
  let restoreProvider = stubProvider('13');

  const strongOpportunity = {
    id: 'opp-1',
    company: 'Acme Corp',
    companyWebsite: 'https://www.acmecorp.com',
    jobTitle: 'Senior Backend Engineer',
    jobDescription: 'We need a backend engineer skilled in Node.js and distributed systems.',
    applicationUrl: 'https://www.acmecorp.com/careers/senior-backend-engineer',
    postedDate: '2026-08-18T00:00:00Z',
    source: 'company careers page',
    contactEmail: 'hiring@acmecorp.com',
  };

  let record = await agent.verify(strongOpportunity);
  restoreSearch();
  restoreProvider();

  assert.strictEqual(record.status, 'VERIFIED', `expected VERIFIED, got ${record.status} (score ${record.score}, reasons: ${record.reasons.join('; ')})`);
  assert.strictEqual(record.companyVerified, true);
  assert.strictEqual(record.contactStatus, 'VERIFIED');
  assert.strictEqual(record.canProceedToOutreach, true);
  console.log(`✓ JobVerificationAgent: strong, fully-matching opportunity scores VERIFIED (${record.score}/100)`);

  // Case 2: no contact email, no application domain match, third-party
  // source - should NOT be allowed to proceed to outreach.
  restoreSearch = stubWebSearch(async () => ({ answer: null, results: [] }));
  restoreProvider = stubProvider('5');

  const weakOpportunity = {
    id: 'opp-2',
    company: 'Totally Real Company LLC',
    jobTitle: 'Marketing Assistant',
    applicationUrl: 'https://randomjobboard.example/listing/123',
    postedDate: '2025-01-01T00:00:00Z', // long stale
    source: 'random aggregator',
  };

  record = await agent.verify(weakOpportunity);
  restoreSearch();
  restoreProvider();

  assert.strictEqual(record.canProceedToOutreach, false, 'weak/unverifiable opportunity must never be allowed to proceed to outreach');
  assert.strictEqual(record.contactStatus, 'UNKNOWN');
  console.log(`✓ JobVerificationAgent: weak/stale opportunity with no verified contact blocked from outreach (status: ${record.status})`);

  // Case 3: expired deadline hard-overrides everything else, even if the
  // rest of the opportunity looks strong.
  restoreSearch = stubWebSearch(async () => ({
    answer: null,
    results: [{ title: 'Acme Corp Careers', url: 'https://www.acmecorp.com/careers', content: 'hiring' }],
  }));
  restoreProvider = stubProvider('15');

  const expiredOpportunity = {
    ...strongOpportunity,
    id: 'opp-3',
    deadline: '2020-01-01T00:00:00Z',
  };

  record = await agent.verify(expiredOpportunity);
  restoreSearch();
  restoreProvider();

  assert.strictEqual(record.status, 'EXPIRED');
  assert.strictEqual(record.canProceedToOutreach, false);
  console.log('✓ JobVerificationAgent: passed deadline forces EXPIRED regardless of how strong the rest of the listing is');

  // Case 4: invalid contact email format is marked INVALID, never silently upgraded.
  restoreSearch = stubWebSearch(async () => ({ answer: null, results: [] }));
  restoreProvider = stubProvider('5');
  record = await agent.verify({ id: 'opp-4', company: 'Some Co', jobTitle: 'Analyst', applicationUrl: 'https://jobs.example.com/1', contactEmail: 'not-an-email' });
  restoreSearch();
  restoreProvider();
  assert.strictEqual(record.contactStatus, 'INVALID');
  console.log('✓ JobVerificationAgent: malformed contact email marked INVALID, not guessed at');

  // Case 5: no TAVILY key configured - degrades honestly instead of faking
  // verification. Mutate the already-loaded config object directly instead
  // of touching process.env + require cache - re-requiring config.js would
  // re-run dotenv.config(), which restores TAVILY_API_KEY from a real local
  // .env file if one is present, silently undoing the "no key" scenario.
  const config = require('../config');
  const originalTavilyKey = config.search.tavilyKey;
  config.search.tavilyKey = null;
  restoreProvider = stubProvider('5');
  record = await agent.verify({ id: 'opp-5', company: 'Acme Corp', jobTitle: 'Engineer', applicationUrl: 'https://acmecorp.com/careers/1', companyWebsite: 'https://acmecorp.com' });
  restoreProvider();
  config.search.tavilyKey = originalTavilyKey;
  assert(record.reasons.some((r) => r.includes('No web search configured')), 'should honestly report search was unavailable');
  assert.notStrictEqual(record.status, 'VERIFIED', 'must not claim VERIFIED without being able to actually check the company exists');
  console.log('✓ JobVerificationAgent: without TAVILY_API_KEY, degrades honestly instead of fabricating verification');

  console.log('\nAll job verification checks passed.');
}

main().catch((err) => {
  console.error('✗ job-verification.test.js failed:', err);
  process.exit(1);
});