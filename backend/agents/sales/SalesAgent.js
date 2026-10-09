const BaseAgent = require('../base/BaseAgent');
const memory = require('../../memory');
const config = require('../../config');
const { selectProvider } = require('../../core/router');

function applicantProfileLine() {
  const p = config.applicant || {};
  const parts = [];
  if (p.fullName)          parts.push(`Name: ${p.fullName}`);
  if (p.location)          parts.push(`Location: ${p.location}`);
  if (p.skills)            parts.push(`Skills: ${p.skills}`);
  if (p.yearsOfExperience) parts.push(`Years of experience: ${p.yearsOfExperience}`);
  if (p.linkedinUrl)       parts.push(`LinkedIn: ${p.linkedinUrl}`);
  return parts.length ? `Applicant profile:\n${parts.join('\n')}\n\n` : '';
}

// Three target role families - always searched together every job hunt run.
// Queries cover each family across multiple job boards.
const JOB_FAMILY_QUERIES = [
  // --- Family A: AI / LLM Engineering ---
  'remote "AI engineer" OR "LLM engineer" OR "AI agent engineer" OR "applied AI" worldwide site:boards.greenhouse.io OR site:jobs.lever.co',
  'remote "AI engineer" OR "GenAI engineer" OR "AI automation engineer" worldwide -"on-site" site:remoteok.com OR site:wellfound.com',
  // --- Family B: Customer Service / Support ---
  'remote "customer support" OR "customer service representative" OR "technical support" worldwide "open to" site:indeed.com',
  'remote "support specialist" OR "help desk" OR "customer success" worldwide site:remoteok.com',
  // --- Family C: Data Entry / Data Operations ---
  'remote "data entry" OR "data processing" OR "data operations assistant" worldwide site:indeed.com',
  'remote "data entry specialist" OR "virtual assistant" "data entry" worldwide site:remoteok.com OR site:wellfound.com',
];

const SCAM_INDICATORS = [
  'training fee', 'registration fee', 'equipment deposit', 'starter kit',
  'send you a cheque', 'buy equipment', 'crypto', 'money transfer', 'payment processing',
  'telegram only', 'whatsapp only', 'signal only',
  'earn $500 daily', '$40/hr typing', 'earn from home',
  'pay per form', 'captcha', 'copy-paste', 'ad posting', 'ad-posting',
  'commission only', 'mlm', 'network marketing',
];

function extractEmail(text) {
  const match = (text || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

const LEAD_GEN_KEYWORDS = [
  'find leads', 'scrape', 'prospect list', 'find businesses', 'find companies',
  'leads that', 'lead generation', 'find me',
];
const LEAD_GEN_PATTERNS = [
  /find\s+\d+\s+/,
  /find\s+\w+\s+in\s+/,
  /draft\s+.*outreach/,
];
function isLeadGenGoal(instruction) {
  const lower = instruction.toLowerCase();
  return LEAD_GEN_KEYWORDS.some((k) => lower.includes(k)) || LEAD_GEN_PATTERNS.some((p) => p.test(lower));
}

// Job-opportunity lead-gen is checked SEPARATELY and takes priority over the
// generic lead-gen path above - matched independently of LEAD_GEN_KEYWORDS
// so phrasing like "find job opportunities in AI" routes correctly even
// though it doesn't contain any of the generic keywords. Job leads get
// routed through the Verified Job Outreach pipeline (verification -> gated
// outreach -> response detection -> scheduling) instead of the generic
// path's direct draft-and-send, since a job listing found via web search is
// exactly the kind of unverified claim that pipeline exists to check before
// any outreach happens.
const JOB_LEAD_KEYWORDS = [
  'job opening', 'job opportunit', 'job posting', 'job listing',
  'hiring for', 'open position', 'open role',
  'find jobs', 'find me jobs', 'find job', 'get me jobs', 'get a job',
  'job hunt', 'job search', 'looking for work', 'looking for a job',
  'apply for jobs', 'apply to jobs', 'apply for me', 'apply on my behalf',
  'jobs for me', 'jobs and apply', 'find.*job.*apply', 'apply.*job',
  'work opportunit', 'employment opportunit',
];

// Also detect "apply" + any job-role context word - catches phrasing like
// "find companies ... and apply" where job intent comes from the verb "apply"
// paired with a role/work signal rather than an explicit "job" keyword.
const JOB_APPLY_SIGNALS = ['apply', 'application', 'applying'];
const JOB_ROLE_SIGNALS  = ['role', 'position', 'engineer', 'developer', 'remote', 'hire me', 'salary', 'full.?stack', 'ai.*integrat', 'integrat.*ai'];

function isJobLeadGenGoal(instruction) {
  const lower = instruction.toLowerCase();
  if (JOB_LEAD_KEYWORDS.some((k) => lower.includes(k))) return true;
  // Secondary check: "apply" + a job-role signal anywhere in the sentence
  const hasApply    = JOB_APPLY_SIGNALS.some((k) => lower.includes(k));
  const hasRoleWord = JOB_ROLE_SIGNALS.some((k) => new RegExp(k).test(lower));
  return hasApply && hasRoleWord;
}

const PLATFORMS = {
  google_maps: { label: 'Google Maps', siteFilter: 'site:google.com/maps' },
  instagram:   { label: 'Instagram',   siteFilter: 'site:instagram.com' },
  facebook:    { label: 'Facebook',    siteFilter: 'site:facebook.com' },
  tiktok:      { label: 'TikTok',      siteFilter: 'site:tiktok.com' },
  x:           { label: 'X (Twitter)', siteFilter: 'site:x.com OR site:twitter.com' },
  linkedin:    { label: 'LinkedIn',    siteFilter: 'site:linkedin.com' },
};
const ALL_PLATFORM_KEYS = Object.keys(PLATFORMS);

function parsePlatforms(instruction) {
  const match = instruction.match(/Search platforms?:\s*(.+)/i);
  if (!match) return ALL_PLATFORM_KEYS;
  const listed = match[1].toLowerCase();
  return ALL_PLATFORM_KEYS.filter((k) => {
    const label = PLATFORMS[k].label.toLowerCase();
    return listed.includes(label) || listed.includes(k.replace(/_/g, ' '));
  });
}

function parseLeadContext(instruction) {
  const target = instruction.match(/Target customer:\s*(.+)/im)?.[1]?.trim() || '';
  const location = instruction.match(/Location:\s*(.+)/im)?.[1]?.trim() || '';
  const countMatch =
    instruction.match(/How many leads:\s*(\d+)/im) ||
    instruction.match(/(\d+)\s+leads/i) ||
    instruction.match(/(\d+)\s+(?:businesses|companies|restaurants|hotels|shops|stores|salons|clinics|agencies)/i) ||
    instruction.match(/find\s+(?:me\s+)?(\d+)/i);
  const count = countMatch ? parseInt(countMatch[1], 10) : 10;

  let nlTarget = '';
  if (!target) {
    const m = instruction.match(/find\s+(?:me\s+)?(?:\d+\s+)?(.+?)\s+(?:in|that|who)\s/i);
    nlTarget = m ? m[1].replace(/^(?:me|some|any)\s+/i, '').trim() : '';
  }
  const nlLocation = location || instruction.match(/\bin\s+([A-Z][a-z]+(?:[,\s]+[A-Z][a-z]+)*)/)?.[1]?.trim() || '';

  const finalTarget = target || nlTarget || 'small businesses';
  const finalLocation = location || nlLocation || 'Accra, Ghana';
  const usedDefaults = { target: !target && !nlTarget, location: !location && !nlLocation };

  return { target: finalTarget, location: finalLocation, count, usedDefaults };
}

/**
 * Turns a broad lead-gen goal into several targeted searches aimed at
 * genuine buying-intent signals (forum questions, hiring posts, "looking
 * for" language) instead of one generic query, which mostly surfaces
 * informational/educational content rather than actual prospects.
 * Falls back to the raw goal as a single query if generation fails.
 */
async function generateSearchQueries(instruction, isJobSearch = false) {
  if (isJobSearch) {
    return JOB_FAMILY_QUERIES;
  }

  try {
    const provider = selectProvider({});
    const system =
      'You generate web search queries for a sales prospecting agent. Read the user\'s goal carefully ' +
      'and determine which kind of prospecting this is:\n\n' +
      'TYPE A — FIND SPECIFIC BUSINESSES (e.g. "find restaurants in Accra", "find hotels in Ghana ' +
      'that need a website", "find 10 bakeries in Lagos"). The user wants ACTUAL NAMED BUSINESSES ' +
      'with contact info. Generate queries that find business directories, Google Maps listings, ' +
      'review sites, and local business pages — NOT Reddit or forum posts. Example queries:\n' +
      '  - "restaurants in Accra Ghana" site:google.com/maps\n' +
      '  - "best restaurants Accra" reviews contact\n' +
      '  - "restaurants Accra Ghana" email OR phone OR "contact us"\n\n' +
      'TYPE B — FIND PEOPLE EXPRESSING NEED (e.g. "find leads interested in AI automation", ' +
      '"find companies looking for web developers"). Generate queries targeting forums, hiring ' +
      'posts, and community signals.\n\n' +
      'Generate 4 distinct queries. For Type A, all 4 must target real business directories, ' +
      'review sites, or business listing pages — NEVER Reddit or forums. For Type B, mix forum ' +
      'and professional sources. Respond with ONLY a JSON array of 4 query strings, no explanation.';
    const result = await provider.complete({ system, prompt: instruction, maxTokens: 500 });
    const match = result.text.match(/\[[\s\S]*\]/);
    const queries = match ? JSON.parse(match[0]) : null;
    return Array.isArray(queries) && queries.length ? queries.slice(0, 4) : [instruction];
  } catch (err) {
    console.warn(`[SalesAgent] query generation failed, falling back to raw goal: ${err.message}`);
    return [instruction];
  }
}

// Anonymous platform posts (Reddit users, job listings) never expose real
// emails - only worth a follow-up search for what looks like an actual
// named company that might have its own public contact page.
function looksLikeRealCompany(name) {
  const lower = (name || '').toLowerCase();
  const platformWords = ['reddit', 'upwork', 'truelancer', 'linkedin', 'client', 'user', 'poster', 'freelancer'];
  return !!name && !platformWords.some((w) => lower.includes(w));
}

/**
 * SalesAgent - two modes, both spawning approval-gated email tasks rather
 * than sending anything directly:
 *
 * 1. Single outreach ("reach out to jane@x.com about...") - research the
 *    one lead, draft one personalized email.
 * 2. Lead generation ("find leads interested in...") - broader search,
 *    extract a list of candidate companies, draft outreach only for the
 *    ones where a real contact email actually turned up in search results.
 *    Contact-email discovery from search alone is unreliable - this is
 *    honestly communicated in the summary, not hidden.
 */
class SalesAgent extends BaseAgent {
  constructor() {
    super({
      key: 'sales',
      role: 'Sales Agent',
      goals: ['Move qualified leads toward a close with relevant, personalized outreach'],
      tools: ['websearch.search', 'gmail.sendEmail', 'whatsapp.sendMessage'],
    });
  }

  async plan(task) {
    const jobLeadGen = isJobLeadGenGoal(task.instruction);
    const leadGen = !jobLeadGen && isLeadGenGoal(task.instruction);

    if (jobLeadGen) {
      // Extracts raw candidate opportunities ONLY - deliberately does NOT
      // draft outreach here. Drafting happens inside the verification
      // pipeline itself (outreachPipeline.draftOutreach), and only for
      // opportunities that actually pass verification - drafting here would
      // mean generating outreach text for jobs that later get rejected,
      // wasted work at best and a temptation to reuse an unverified draft
      // at worst.
      const jobListInstruction =
        'Applicant: Fuseini Zackaria, AI Software Engineer / Full-Stack Developer based in Ghana (remote-only).\n' +
        'Target role families (include ALL that match from the search results):\n' +
        '  A. AI/LLM Engineering: AI engineer, LLM engineer, AI agent engineer, GenAI/applied AI engineer, AI automation engineer. Core work must involve LLMs, agents, RAG or tool-calling. Skip general full-stack/frontend unless AI is central. Exclude ML research/model-training.\n' +
        '  B. Customer Service / Support: customer support rep, technical support, help desk (tier 1-2), chat/email support, support specialist. Full-time/regular part-time at real companies.\n' +
        '  C. Data Entry / Operations: data entry clerk/specialist, data processing/operations assistant, CRM data entry, back-office data admin, VA roles that are mainly data entry.\n' +
        'INCLUDE: remote roles open to worldwide / Africa / Ghana. Entry-level to mid. Drop team lead/manager/5+ year roles.\n' +
        'EXCLUDE (drop silently): on-site only, restricted to US/Canada/UK/EU only, data-annotation / AI trainer / crowd-rating gigs (Outlier, Remotasks, etc.), commission-only, MLM.\n' +
        'SCAM FILTER - drop any listing that contains: ' + SCAM_INDICATORS.join(', ') + '.\n\n' +
        'From the search results, extract up to 20 distinct genuine JOB OPENINGS passing all filters above. ' +
        'For each, extract ONLY fields actually present - never invent a URL, email or date; use null if not present. ' +
        'Add a "roleFamily" field: "AI", "CS", or "DE". ' +
        'Respond with ONLY a JSON array:\n' +
        '[{"company":"...","jobTitle":"...","roleFamily":"AI|CS|DE","applicationUrl":null,"companyWebsite":null,' +
        '"postedDate":null,"contactEmail":null,"source":"...","sourceUrl":"...",' +
        '"context":"1-2 sentences of context for relevance scoring"}]';

      if (!config.search.tavilyKey) {
        return [
          {
            type: 'llm_call',
            maxTokens: 2048,
            instruction: `${task.instruction}\n\nNo web search is configured, so answer from general knowledge only - be upfront that this is not live/verified data. ${jobListInstruction}`,
          },
        ];
      }

      const queries = await generateSearchQueries(task.instruction, true); // isJobSearch=true → 3-family fixed queries
      const searchSteps = queries.map((q) => ({
        type: 'tool_call',
        tool: 'websearch.search',
        args: { query: q, maxResults: 7 },
      }));
      return [...searchSteps, { type: 'llm_call', maxTokens: 14000, instruction: jobListInstruction }];
    }

    if (leadGen) {
      const ctx = parseLeadContext(task.instruction);
      const platforms = parsePlatforms(task.instruction);
      const count = ctx.count || 15;

      const listInstruction =
        `From the search results above, extract up to ${count} distinct REAL, NAMED businesses ` +
        'that match the search criteria. When the SAME business appears in results from different ' +
        'platforms (match by name + location), MERGE them into one entry with all profile links.\n\n' +
        'For each business, extract ONLY what is ACTUALLY present — never invent or guess:\n' +
        '- name: business name\n' +
        '- type: kind of business (e.g. "restaurant", "hotel")\n' +
        '- location: address or area if found, else null\n' +
        '- platforms: array of { "platform": "google_maps|instagram|facebook|tiktok|x|linkedin|web", ' +
        '"profileUrl": "...", "followers": "count if visible else null", "bio": "short excerpt if visible else null" }\n' +
        '- email: only if ACTUALLY found, else null\n' +
        '- phone: only if ACTUALLY found, else null\n' +
        '- website: existing website URL if found, else null\n' +
        '- emailSource: URL where the email was found, else null\n' +
        '- phoneSource: URL where the phone was found, else null\n' +
        '- needsWebsite: true if the business appears not to have a proper, working website ' +
        '(no website found, or link only goes to a social page / linktree / link-in-bio). ' +
        'Mark uncertain cases as true with medium confidence rather than excluding them\n' +
        '- needsWebsiteReason: plain English explanation\n' +
        '- confidence: "high" (2+ platforms with contact), "medium" (1 platform or limited), "low" (uncertain)\n' +
        '- activityLevel: brief note on followers/reviews/activity if visible, else null\n\n' +
        'Respond with ONLY a JSON array.';

      if (!config.search.tavilyKey) {
        return [
          {
            type: 'llm_call',
            maxTokens: 2048,
            instruction: `${task.instruction}\n\nNo web search is configured. ${listInstruction}`,
          },
        ];
      }

      const searchQueries = platforms.map((p) =>
        `${ctx.target} ${ctx.location} ${PLATFORMS[p].siteFilter}`
      );
      searchQueries.push(`${ctx.target} ${ctx.location} contact email phone "contact us"`);
      if (ctx.usedDefaults.target || ctx.usedDefaults.location) {
        searchQueries.push(`${ctx.target} ${ctx.location} directory listing`);
      }

      const searchSteps = searchQueries.map((q) => ({
        type: 'tool_call',
        tool: 'websearch.search',
        args: { query: q, maxResults: 10 },
      }));
      return [...searchSteps, { type: 'llm_call', maxTokens: 12000, instruction: listInstruction }];
    }

    const draftInstruction =
      'Based on anything above, draft a short, genuinely personalized outreach email (not generic) ' +
      'introducing our business to this lead. Keep it under 120 words, no hard sell. ' +
      'Respond with ONLY a JSON object: {"to": "email or null if not found", "subject": "...", "body": "..."}';

    if (config.search.tavilyKey) {
      return [
        { type: 'tool_call', tool: 'websearch.search', args: { query: task.instruction } },
        { type: 'llm_call', maxTokens: 1024, instruction: draftInstruction },
      ];
    }
    return [{ type: 'llm_call', maxTokens: 1024, instruction: draftInstruction }];
  }

  async reflect(task, results) {
    const finalStep = results[results.length - 1];

    if (isJobLeadGenGoal(task.instruction)) {
      let leads = [];
      try {
        const match = finalStep?.text?.match(/\[[\s\S]*\]/);
        if (match) leads = JSON.parse(match[0]);
      } catch (err) {
        console.warn(`[SalesAgent] failed to parse job lead list: ${err.message}`);
      }

      // Only require company + jobTitle to attempt verification - everything
      // else missing just honestly reduces the score inside
      // JobVerificationAgent (e.g. no applicationUrl -> flagged, no
      // postedDate -> POSTING_DATE_UNKNOWN) rather than being invented here.
      const candidates = leads.filter((l) => l.company && l.jobTitle);

      const outreachPipeline = require('../../core/outreachPipeline');
      const toolRegistry = require('../../tools/ToolRegistry');
      let verified = 0;
      let rejected = 0;
      let failed = 0;
      const manualApplyJobs = []; // login-gated jobs to email the user about

      for (const lead of candidates) {
        const opportunity = {
          company: lead.company,
          jobTitle: lead.jobTitle,
          roleFamily: lead.roleFamily || 'AI', // AI | CS | DE
          applicationUrl: lead.applicationUrl || null,
          companyWebsite: lead.companyWebsite || null,
          postedDate: lead.postedDate || null,
          contactEmail: lead.contactEmail || null,
          source: lead.source || lead.sourceUrl || 'lead-gen search',
          jobDescription: lead.context || null,
        };
        try {
          const record = await outreachPipeline.processOpportunity(opportunity, { mode: config.outreach.mode });
          if (record.stage && record.stage.startsWith('rejected')) rejected++;
          else {
            verified++;
            // Collect login-gated jobs that need manual application
            if (record.stage === 'application_skipped' && record.applySkipReason &&
                record.applySkipReason.toLowerCase().includes('login-gated')) {
              manualApplyJobs.push({
                jobTitle: opportunity.jobTitle,
                company: opportunity.company,
                url: opportunity.applicationUrl,
                reason: record.applySkipReason,
              });
            }
          }
        } catch (err) {
          failed++;
          console.warn(`[SalesAgent] job lead-gen: failed to process opportunity for "${lead.company}": ${err.message}`);
        }
      }

      // Send one summary email for all login-gated jobs so the user can
      // apply to them manually without hunting through the Tasks page.
      //
      // This is an owner self-notification, not outreach to another person,
      // so it goes through the Gmail guard's `systemDigest` path. The guard
      // enforces that systemDigest sends are only ever addressed to
      // config.applicant.email - no arbitrary recipient can slip through
      // this call site. Subject is prefixed with [CodeCraft/System] so
      // inbox triage filters recognize it as app-generated mail and skip it.
      if (manualApplyJobs.length > 0 && config.applicant?.email) {
        try {
          const jobLines = manualApplyJobs
            .map((j, i) => `${i + 1}. ${j.jobTitle} at ${j.company}\n   Apply: ${j.url || '(no URL)'}`)
            .join('\n\n');
          await toolRegistry.call(
            'gmail.sendEmail',
            {
              to: config.applicant.email,
              subject: `[CodeCraft/System] ${manualApplyJobs.length} job(s) need your manual application`,
              body:
                `Hi Fuseini,\n\n` +
                `CodeCraft found ${manualApplyJobs.length} job(s) that require manual application ` +
                `because they need you to be logged in (LinkedIn, Wellfound, etc.).\n\n` +
                `${jobLines}\n\n` +
                `The rest of your jobs are in the Tasks page awaiting your approval to auto-submit.\n\n` +
                `— CodeCraft`,
            },
            { role: 'sales', systemDigest: true }
          );
          console.log(`[SalesAgent] sent manual-apply digest to the configured owner address (${manualApplyJobs.length} jobs)`);
        } catch (emailErr) {
          console.warn(`[SalesAgent] could not send manual-apply digest: ${emailErr.message}`);
        }
      }

      return {
        summary:
          `Found ${leads.length} candidate job opening(s), ran ${candidates.length} through verification: ` +
          `${verified} passed and moved into the outreach pipeline, ${rejected} rejected as unverifiable, ${failed} failed to process. ` +
          (manualApplyJobs.length ? `${manualApplyJobs.length} login-gated job(s) sent to your email for manual application. ` : '') +
          `Check the Job Outreach page for details.`,
        leadsFound: leads.length,
        verified,
        rejected,
        failed,
      };
    }

    if (isLeadGenGoal(task.instruction)) {
      const ctx = parseLeadContext(task.instruction);
      const warnings = [];

      for (const r of results) {
        if (r?.error) warnings.push(`Search failed: ${r.error}`);
      }

      let leads = [];
      try {
        const match = finalStep?.text?.match(/\[[\s\S]*\]/);
        if (match) leads = JSON.parse(match[0]);
      } catch (err) {
        warnings.push(`Failed to parse lead list: ${err.message}`);
      }

      for (const l of leads) {
        if (l.company && !l.name) l.name = l.company;
        if (l.contactEmail && !l.email) l.email = l.contactEmail;
      }

      if (ctx.usedDefaults.target) warnings.push(`No target specified — defaulted to "${ctx.target}".`);
      if (ctx.usedDefaults.location) warnings.push(`No location specified — defaulted to "${ctx.location}".`);

      if (leads.length < Math.ceil(ctx.count / 2) && config.search.tavilyKey) {
        try {
          const broadQueries = [
            `${ctx.target} ${ctx.location} directory listing contact`,
            `best ${ctx.target} ${ctx.location} reviews`,
            `"${ctx.target}" "${ctx.location}" email phone website`,
          ];
          const extraContent = [];
          for (const q of broadQueries) {
            try {
              const sr = await this.execute(
                { type: 'tool_call', tool: 'websearch.search', args: { query: q, maxResults: 10 } },
                task
              );
              if (sr?.results) extraContent.push(...sr.results);
            } catch (err) {
              warnings.push(`Retry search failed: ${err.message}`);
            }
          }
          if (extraContent.length) {
            const remaining = ctx.count - leads.length;
            const existingNames = new Set(leads.map((l) => (l.name || '').toLowerCase()));
            const provider = selectProvider({});
            const extractResult = await provider.complete({
              maxTokens: 8000,
              system:
                `Extract up to ${remaining} distinct REAL, NAMED businesses from these search results. ` +
                `Skip any business already found: ${[...existingNames].join(', ')}. ` +
                'For each, extract: name, type, location, platforms (array of {platform, profileUrl}), ' +
                'email (if found), phone (if found), website (if found), needsWebsite (boolean), ' +
                'needsWebsiteReason, confidence (high/medium/low). ' +
                'Respond with ONLY a JSON array.',
              prompt: JSON.stringify(extraContent.map((r) => ({ title: r.title, url: r.url, content: r.content }))),
            });
            const m = extractResult.text.match(/\[[\s\S]*\]/);
            if (m) {
              const moreLeads = JSON.parse(m[0]);
              for (const l of moreLeads) {
                if (l.company && !l.name) l.name = l.company;
                if (l.contactEmail && !l.email) l.email = l.contactEmail;
                if (!existingNames.has((l.name || '').toLowerCase())) {
                  leads.push(l);
                  existingNames.add((l.name || '').toLowerCase());
                }
              }
            }
          }
        } catch (err) {
          warnings.push(`Retry extraction failed: ${err.message}`);
        }
      }

      const needsContactSearch = leads
        .filter((l) => !l.email && !l.phone && looksLikeRealCompany(l.name))
        .slice(0, 10);

      for (const lead of needsContactSearch) {
        try {
          const loc = lead.location || ctx.location;
          const query = `"${lead.name}" ${loc} contact email phone "contact us"`;
          const searchResult = await this.execute(
            { type: 'tool_call', tool: 'websearch.search', args: { query, maxResults: 4 } },
            task
          );
          const combined = (searchResult?.results || []).map((r) => r.content).join(' ');
          const email = extractEmail(combined);
          const phone = combined.match(/(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/)?.[0] || null;
          const website = combined.match(/https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s"')]*)?/)?.[0] || null;
          if (email) { lead.email = email; lead.emailSource = searchResult?.results?.[0]?.url || null; }
          if (phone) { lead.phone = phone; lead.phoneSource = searchResult?.results?.[0]?.url || null; }
          if (website && !lead.website) lead.website = website;
        } catch (err) {
          warnings.push(`Contact search failed for "${lead.name}": ${err.message}`);
        }
      }

      const emailLeads = leads.filter((l) => l.email);
      const whatsappOnlyLeads = leads.filter((l) => l.phone && !l.email);
      const socialOnlyLeads = leads.filter((l) => !l.email && !l.phone && (l.platforms || []).length > 0);
      const noContactLeads = leads.filter((l) => !l.email && !l.phone && !(l.platforms || []).length);

      let emailDrafted = 0;
      if (emailLeads.length) {
        try {
          const provider = selectProvider({});
          const draftResult = await provider.complete({
            maxTokens: 3000,
            system:
              'For each lead below, draft a short (under 100 words), genuinely personalized outreach ' +
              'email. Mention something real and specific about that business. Friendly, professional ' +
              'tone suited to Ghanaian small-business owners. Respond with ONLY a JSON array: ' +
              '[{"name": "...", "email": "...", "subject": "...", "body": "..."}]',
            prompt: JSON.stringify(emailLeads.map((l) => ({
              name: l.name, email: l.email, type: l.type, location: l.location,
              needsWebsiteReason: l.needsWebsiteReason, activityLevel: l.activityLevel,
            }))),
          });
          const m = draftResult.text.match(/\[[\s\S]*\]/);
          const drafts = m ? JSON.parse(m[0]) : [];
          for (const d of drafts) {
            if (!d.email || !d.subject || !d.body) continue;
            await this.createApprovalTask({
              instruction: `Send outreach email to ${d.name} (${d.email})`,
              tool: 'gmail.sendEmail',
              payload: { to: d.email, subject: d.subject, body: d.body },
              outreach: {
                recipientEmail: d.email,
                companyName: d.name || null,
                campaign: 'lead_gen',
              },
            });
            emailDrafted++;
          }
        } catch (err) {
          warnings.push(`Email drafting failed: ${err.message}`);
        }
      }

      let whatsappDrafted = 0;
      if (whatsappOnlyLeads.length) {
        try {
          const provider = selectProvider({});
          const draftResult = await provider.complete({
            maxTokens: 2000,
            system:
              'For each lead below, draft a short WhatsApp message (under 80 words). ' +
              'Mention something real about the business. Friendly, professional tone suited to ' +
              'Ghanaian small-business owners. Start with a greeting. Respond with ONLY a JSON array: ' +
              '[{"name": "...", "phone": "...", "message": "..."}]',
            prompt: JSON.stringify(whatsappOnlyLeads.map((l) => ({
              name: l.name, phone: l.phone, type: l.type, location: l.location,
              needsWebsiteReason: l.needsWebsiteReason,
            }))),
          });
          const m = draftResult.text.match(/\[[\s\S]*\]/);
          const drafts = m ? JSON.parse(m[0]) : [];
          for (const d of drafts) {
            if (!d.phone || !d.message) continue;
            await this.createApprovalTask({
              instruction: `Send WhatsApp message to ${d.name} (${d.phone})`,
              tool: 'whatsapp.sendMessage',
              payload: { to: d.phone, message: d.message },
            });
            whatsappDrafted++;
          }
        } catch (err) {
          warnings.push(`WhatsApp drafting failed: ${err.message}`);
        }
      }

      if (socialOnlyLeads.length) {
        try {
          const provider = selectProvider({});
          const draftResult = await provider.complete({
            maxTokens: 2000,
            system:
              'For each lead below, draft a short DM (under 60 words) suitable for Instagram, ' +
              'Facebook, or other social platforms. Mention something specific about the business. ' +
              'Friendly, professional, suited to Ghanaian small-business owners. ' +
              'Respond with ONLY a JSON array: [{"name": "...", "message": "..."}]',
            prompt: JSON.stringify(socialOnlyLeads.map((l) => ({
              name: l.name, type: l.type, location: l.location,
              needsWebsiteReason: l.needsWebsiteReason,
              platforms: (l.platforms || []).map((p) => p.platform),
            }))),
          });
          const m = draftResult.text.match(/\[[\s\S]*\]/);
          const drafts = m ? JSON.parse(m[0]) : [];
          for (const d of drafts) {
            const lead = socialOnlyLeads.find((l) => l.name === d.name);
            if (lead && d.message) lead.socialDraft = d.message;
          }
        } catch (err) {
          warnings.push(`Social DM drafting failed: ${err.message}`);
        }
      }

      const totalDrafted = emailDrafted + whatsappDrafted;
      let note = `Found ${leads.length} lead(s) across multiple platforms.`;
      if (emailDrafted) note += ` ${emailDrafted} email draft(s)`;
      if (whatsappDrafted) note += `${emailDrafted ? ',' : ''} ${whatsappDrafted} WhatsApp draft(s)`;
      if (totalDrafted) note += ' — awaiting your approval.';
      if (socialOnlyLeads.length) note += ` ${socialOnlyLeads.length} social-only lead(s) with draft DMs.`;
      if (noContactLeads.length) note += ` ${noContactLeads.length} lead(s) need manual outreach (no contact info found).`;
      await memory.addReflection(this.role, task.id, note);

      results.push({
        type: 'lead_cards',
        summary: note,
        warnings,
        leads: leads.map((l) => ({
          name: l.name,
          type: l.type || null,
          location: l.location || null,
          platforms: l.platforms || [],
          email: l.email || null,
          phone: l.phone || null,
          whatsapp: l.phone || null,
          website: l.website || null,
          emailSource: l.emailSource || null,
          phoneSource: l.phoneSource || null,
          needsWebsite: !!l.needsWebsite,
          needsWebsiteReason: l.needsWebsiteReason || null,
          confidence: l.confidence || 'medium',
          activityLevel: l.activityLevel || null,
          socialDraft: l.socialDraft || null,
          outreachChannel: l.email ? 'email' : l.phone ? 'whatsapp' : (l.platforms || []).length ? 'social' : 'manual',
        })),
      });

      return note;
    }

    // Single-lead outreach mode
    let draft = null;
    try {
      const match = finalStep?.text?.match(/\{[\s\S]*\}/);
      if (match) draft = JSON.parse(match[0]);
    } catch (err) {
      console.warn(`[SalesAgent] failed to parse outreach draft: ${err.message}`);
    }

    const to = draft?.to || extractEmail(task.instruction);
    let note;
    if (draft && to && draft.subject && draft.body) {
      await this.createApprovalTask({
        instruction: `Send outreach email to ${to}`,
        tool: 'gmail.sendEmail',
        payload: { to, subject: draft.subject, body: draft.body },
        outreach: {
          recipientEmail: to,
          campaign: 'single',
        },
      });
      note = `Drafted outreach to ${to} — awaiting your approval on the Tasks page.`;
    } else {
      note = `Couldn't find a clear recipient email for this outreach — mention the email address explicitly and try again.`;
    }
    await memory.addReflection(this.role, task.id, note);
    return note;
  }

  async run(task) {
    const isLeadGen = isLeadGenGoal(task.instruction) || isJobLeadGenGoal(task.instruction);
    if (!isLeadGen) return super.run(task);

    const activityLog = require('../../core/activityLog');
    await activityLog.record(this.role, 'task_started', this.key, { taskId: task.id, instruction: task.instruction });
    await memory.remember(this.role, { type: 'task_start', taskId: task.id, instruction: task.instruction });

    try {
      const steps = await this.plan(task);
      await activityLog.record(this.role, 'plan_created', this.key, { taskId: task.id, stepCount: steps.length });

      const results = [];
      let context = '';
      for (const step of steps) {
        try {
          const result = await this.execute(step, task, context);
          results.push(result);
          const resultText = result?.text || (result ? JSON.stringify(result) : '');
          if (resultText) context += `${context ? '\n\n' : ''}${resultText}`;
        } catch (err) {
          console.warn(`[SalesAgent] step failed (${step.tool || step.type}): ${err.message}`);
          results.push({ error: err.message, tool: step.tool || step.type });
        }
      }

      await this.reflect(task, results);
      await memory.remember(this.role, { type: 'task_end', taskId: task.id });
      await activityLog.record(this.role, 'task_completed', this.key, { taskId: task.id, stepCount: results.length });

      return results;
    } catch (err) {
      await activityLog.record(this.role, 'task_failed', this.key, { taskId: task.id, error: err.message });
      throw err;
    }
  }
}

module.exports = SalesAgent;