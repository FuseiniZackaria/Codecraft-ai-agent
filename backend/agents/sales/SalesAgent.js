const BaseAgent = require('../base/BaseAgent');
const memory = require('../../memory');
const config = require('../../config');
const { selectProvider } = require('../../core/router');
const { extractThingId } = require('../../core/redditUtils');

function extractEmail(text) {
  const match = (text || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

const LEAD_GEN_KEYWORDS = ['find leads', 'scrape', 'prospect list', 'find businesses', 'find companies', 'leads that', 'lead generation'];
function isLeadGenGoal(instruction) {
  const lower = instruction.toLowerCase();
  return LEAD_GEN_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * Turns a broad lead-gen goal into several targeted searches aimed at
 * genuine buying-intent signals (forum questions, hiring posts, "looking
 * for" language) instead of one generic query, which mostly surfaces
 * informational/educational content rather than actual prospects.
 * Falls back to the raw goal as a single query if generation fails.
 */
async function generateSearchQueries(instruction) {
  try {
    const provider = selectProvider({});
    const result = await provider.complete({
      system:
        'Generate 3 distinct, targeted web search queries to find people/businesses actively ' +
        'expressing NEED or INTENT to do the thing described - not generic articles or tutorials ' +
        'about the topic. Favor phrasing real people use when asking for help or hiring: "looking ' +
        'for", "need help integrating", "hiring developer for", forum/community language (e.g. ' +
        'site:reddit.com, site:indiehackers.com), or recent hiring posts. Respond with ONLY a JSON ' +
        'array of 3 query strings, no explanation.',
      prompt: instruction,
      maxTokens: 400,
    });
    const match = result.text.match(/\[[\s\S]*\]/);
    const queries = match ? JSON.parse(match[0]) : null;
    return Array.isArray(queries) && queries.length ? queries.slice(0, 3) : [instruction];
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
      tools: ['websearch.search', 'gmail.sendEmail', 'reddit.postComment'],
    });
  }

  async plan(task) {
    const leadGen = isLeadGenGoal(task.instruction);

    if (leadGen) {
      const listInstruction =
        'From the search results above (from several targeted searches), extract up to 15 distinct ' +
        'companies/people that show ACTUAL intent or need - someone asking for help, hiring for it, or ' +
        'announcing they are doing it - not just content that mentions the topic informationally. Skip ' +
        'generic articles, news, and tutorials entirely, even if on-topic. For each real lead, only ' +
        'include a contactEmail if one is ACTUALLY present in the search result content - never invent ' +
        'or guess one. If (and only if) a real contactEmail was found, also draft a short (under 100 ' +
        'words), genuinely personalized outreach subject+body; otherwise leave subject/body null. ' +
        'Respond with ONLY a JSON array, this exact shape: ' +
        '[{"company": "...", "reason": "why this shows real intent, not just relevance", "sourceUrl": "...", ' +
        '"contactEmail": "..." or null, "subject": "..." or null, "body": "..." or null}]';

      if (!config.search.tavilyKey) {
        return [
          {
            type: 'llm_call',
            maxTokens: 2048,
            instruction: `${task.instruction}\n\nNo web search is configured, so answer from general knowledge only - be upfront that this is not live/verified data. ${listInstruction}`,
          },
        ];
      }

      const queries = await generateSearchQueries(task.instruction);
      const searchSteps = queries.map((q) => ({
        type: 'tool_call',
        tool: 'websearch.search',
        args: { query: q, maxResults: 6 },
      }));
      return [...searchSteps, { type: 'llm_call', maxTokens: 6000, instruction: listInstruction }];
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

    if (isLeadGenGoal(task.instruction)) {
      let leads = [];
      try {
        const match = finalStep?.text?.match(/\[[\s\S]*\]/);
        if (match) leads = JSON.parse(match[0]);
      } catch (err) {
        console.warn(`[SalesAgent] failed to parse lead list: ${err.message}`);
      }

      const withContact = leads.filter((l) => l.contactEmail && l.subject && l.body);
      for (const lead of withContact) {
        await this.createApprovalTask({
          instruction: `Send outreach email to ${lead.company} (${lead.contactEmail})`,
          tool: 'gmail.sendEmail',
          payload: { to: lead.contactEmail, subject: lead.subject, body: lead.body },
        });
      }

      // Bounded follow-up: for real named companies (not anonymous platform
      // posts) with no email found yet, try one targeted "company contact"
      // search each - capped at 3 to control cost - since those often have
      // a public contact page even when the original search didn't surface it.
      const worthFollowUp = leads.filter((l) => !l.contactEmail && looksLikeRealCompany(l.company)).slice(0, 3);
      const followUpFound = [];

      for (const lead of worthFollowUp) {
        try {
          const searchResult = await this.execute(
            { type: 'tool_call', tool: 'websearch.search', args: { query: `${lead.company} official contact email`, maxResults: 3 } },
            task
          );
          const combined = (searchResult?.results || []).map((r) => r.content).join(' ');
          const email = extractEmail(combined);
          if (email) followUpFound.push({ ...lead, contactEmail: email });
        } catch (err) {
          console.warn(`[SalesAgent] follow-up contact search failed for "${lead.company}": ${err.message}`);
        }
      }

      let followUpDrafted = 0;
      if (followUpFound.length) {
        try {
          const provider = selectProvider({});
          const draftResult = await provider.complete({
            maxTokens: 2048,
            system:
              'For each lead below, draft a short (under 100 words), genuinely personalized outreach ' +
              'subject+body based on its "reason". Respond with ONLY a JSON array: ' +
              '[{"company": "...", "contactEmail": "...", "subject": "...", "body": "..."}]',
            prompt: JSON.stringify(followUpFound.map((l) => ({ company: l.company, reason: l.reason, contactEmail: l.contactEmail }))),
          });
          const match = draftResult.text.match(/\[[\s\S]*\]/);
          const drafts = match ? JSON.parse(match[0]) : [];
          for (const d of drafts) {
            if (!d.contactEmail || !d.subject || !d.body) continue;
            await this.createApprovalTask({
              instruction: `Send outreach email to ${d.company} (${d.contactEmail})`,
              tool: 'gmail.sendEmail',
              payload: { to: d.contactEmail, subject: d.subject, body: d.body },
            });
            followUpDrafted++;
          }
        } catch (err) {
          console.warn(`[SalesAgent] follow-up draft batch failed: ${err.message}`);
        }
      }

      const totalDrafted = withContact.length + followUpDrafted;

      // Reddit-sourced leads with no email are a different channel entirely -
      // the right action is replying on the thread itself, not searching for
      // a contact that was never public. Draft real, approval-gated replies.
      const alreadyHandled = new Set([...withContact, ...followUpFound].map((l) => l.sourceUrl));
      const redditLeads = leads
        .filter((l) => !alreadyHandled.has(l.sourceUrl) && /reddit\.com/i.test(l.sourceUrl || ''))
        .map((l) => ({ ...l, thingId: extractThingId(l.sourceUrl) }))
        .filter((l) => l.thingId)
        .slice(0, 5);

      let redditDrafted = 0;
      if (redditLeads.length) {
        try {
          const provider = selectProvider({});
          const draftResult = await provider.complete({
            maxTokens: 2048,
            system:
              'For each Reddit thread below, draft a short, genuinely helpful reply comment (under 80 ' +
              'words) that adds real value first - Reddit communities heavily penalize blatant self-promotion. ' +
              'Only naturally mention our business if it genuinely fits as a helpful suggestion, not a pitch. ' +
              'Respond with ONLY a JSON array: [{"sourceUrl": "...", "text": "..."}]',
            prompt: JSON.stringify(redditLeads.map((l) => ({ sourceUrl: l.sourceUrl, reason: l.reason }))),
          });
          const match = draftResult.text.match(/\[[\s\S]*\]/);
          const drafts = match ? JSON.parse(match[0]) : [];
          for (const d of drafts) {
            const lead = redditLeads.find((l) => l.sourceUrl === d.sourceUrl);
            if (!lead || !d.text) continue;
            await this.createApprovalTask({
              instruction: `Reply on Reddit thread: ${lead.company}`,
              tool: 'reddit.postComment',
              payload: { thingId: lead.thingId, text: d.text },
            });
            redditDrafted++;
          }
        } catch (err) {
          console.warn(`[SalesAgent] reddit reply draft batch failed: ${err.message}`);
        }
      }

      const note =
        `Found ${leads.length} candidate lead(s). ${totalDrafted} got a draft outreach email` +
        `${followUpDrafted ? ` (${followUpDrafted} via follow-up contact search)` : ''} and ${redditDrafted} ` +
        `got a draft Reddit reply - all awaiting your approval on the Tasks page.`;
      await memory.addReflection(this.role, task.id, note);
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
      });
      note = `Drafted outreach to ${to} — awaiting your approval on the Tasks page.`;
    } else {
      note = `Couldn't find a clear recipient email for this outreach — mention the email address explicitly and try again.`;
    }
    await memory.addReflection(this.role, task.id, note);
    return note;
  }
}

module.exports = SalesAgent;
