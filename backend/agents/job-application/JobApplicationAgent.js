const BaseAgent = require('../base/BaseAgent');
const config = require('../../config');
const { selectProvider } = require('../../core/router');
const { navigate, readPage } = require('../../core/browserAutomation/browserSession');

// Stated background used verbatim in cover emails — never embellished.
const BACKGROUND =
  'AI Software Engineer / Full-Stack Developer, founder of CodeCraft (2026-present): ' +
  'built CodeCraft AI, a multi-agent LLM platform (OpenAI/Claude/Gemini/Ollama, RAG, tool calling); ' +
  'business systems for inventory, sales, education, real estate (React, TypeScript, Laravel, PHP, MySQL, Supabase); ' +
  'APIs, authentication, databases, third-party integrations; troubleshooting frontend, backend, ' +
  'dependency and API issues. Diploma in Business Computing - Web Development (AITI-KACE, 2023-2024).';

const TRANSFERABLE = {
  CS: 'Transferable strengths relevant to customer/technical support: ' +
      'troubleshooting and debugging complex issues, explaining technical problems clearly, ' +
      'building and maintaining business systems (inventory, sales, records), ' +
      'independent remote work, computer literacy.',
  DE: 'Transferable strengths relevant to data entry/operations: ' +
      'SQL and database work, building and maintaining inventory/sales/records systems, ' +
      'accuracy with structured data, computer literacy, independent remote work.',
};

// Job boards that always require login — we can read the page but won't find
// a real apply email there, so skip navigation entirely.
const ALWAYS_LOGIN_GATED = ['linkedin.com', 'wellfound.com', 'angel.co'];

/**
 * JobApplicationAgent — email-first application strategy.
 *
 * For each verified opportunity:
 *   1. If the application URL is on a login-gated job board → skip (user will
 *      receive a manual-apply digest email from SalesAgent.reflect).
 *   2. Otherwise navigate to the URL and read the page for an apply email.
 *   3. If a real apply email is found → draft a tailored cover email →
 *      createApprovalTask(gmail.sendEmail) so the user reviews before sending.
 *   4. If no email is found → skip with a clear reason.
 *
 * No ATS web-form submission: applications are sent by email only.
 */
class JobApplicationAgent extends BaseAgent {
  constructor() {
    super({
      key: 'job-application',
      role: 'Job Application Agent',
      goals: ['Prepare a tailored application email for human review and approval'],
      tools: ['browser.navigate', 'browser.readPage', 'gmail.sendEmail'],
    });
  }

  /**
   * @param {object} opportunity - verified opportunity from the pipeline
   * @returns {object} { status, approvalTaskId?, reason? }
   */
  async applyForOpportunity(opportunity) {
    const { applicationUrl, company, jobTitle, jobDescription, roleFamily = 'AI', contactEmail } = opportunity;

    const profile = config.applicant;
    if (!profile.fullName || !profile.email) {
      return {
        status: 'skipped',
        reason: 'Applicant profile missing APPLICANT_FULL_NAME or APPLICANT_EMAIL in .env.',
      };
    }

    // --- Step 1: Resolve application email ---
    // Priority: already known contactEmail > scrape from page > give up
    let applyEmail = contactEmail || null;

    if (!applyEmail) {
      if (!applicationUrl) {
        return { status: 'skipped', reason: 'No application URL and no contact email — cannot apply.' };
      }

      const urlLower = applicationUrl.toLowerCase();
      if (ALWAYS_LOGIN_GATED.some((d) => urlLower.includes(d))) {
        return {
          status: 'skipped',
          reason: `Login-gated: ${new URL(applicationUrl).hostname} requires an account. Apply manually at: ${applicationUrl}`,
        };
      }

      // Navigate and scan page for an apply email
      try {
        const navResult = await navigate(applicationUrl);
        const finalUrl = (navResult.url || '').toLowerCase();
        if (['/login', '/signin', '/authwall', '/auth/'].some((p) => finalUrl.includes(p))) {
          return {
            status: 'skipped',
            reason: `Login-gated: page redirected to ${navResult.url}. Apply manually at: ${applicationUrl}`,
          };
        }
        const pageContent = await readPage();
        const emailMatches = pageContent.text.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g) || [];
        // Filter out job-board platform addresses
        const PLATFORM_DOMAINS = ['linkedin.com', 'indeed.com', 'greenhouse.io', 'lever.co',
                                   'wellfound.com', 'remoteok.com', 'sentry.io'];
        const candidates = emailMatches.filter((e) => {
          const d = (e.split('@')[1] || '').toLowerCase();
          return !PLATFORM_DOMAINS.includes(d);
        });
        applyEmail = candidates[0] || null;
      } catch (err) {
        console.warn(`[JobApplicationAgent] could not read ${applicationUrl}: ${err.message}`);
      }
    }

    if (!applyEmail) {
      return {
        status: 'skipped',
        reason:
          `No application email found for ${company}. ` +
          `Apply manually at: ${applicationUrl || 'check company website'}`,
      };
    }

    // --- Step 2: Draft tailored cover email ---
    const familyExtra = TRANSFERABLE[roleFamily] || '';
    const portfolioLine = profile.portfolioUrl ? `\nWork sample: ${profile.portfolioUrl}` : '';
    const linkedinLine  = profile.linkedinUrl  ? `\nLinkedIn: ${profile.linkedinUrl}` : '';

    let emailDraft;
    try {
      const provider = selectProvider({});
      const result = await provider.complete({
        system:
          'Draft a short, genuine job application email — under 200 words. ' +
          'Do NOT exaggerate or invent skills, experience, years or certifications beyond what is stated. ' +
          'Do NOT claim customer service or data entry job history unless the background states it. ' +
          'Use only the stated background and transferable strengths. ' +
          'Respond with ONLY a JSON object: {"subject": "...", "body": "..."}',
        prompt:
          `Role: ${jobTitle} at ${company}\n` +
          `Job context: ${jobDescription || '(no description)'}\n\n` +
          `Background:\n${BACKGROUND}\n\n` +
          (familyExtra ? `${familyExtra}\n\n` : '') +
          `Name: ${profile.fullName}\nEmail: ${profile.email}\nLocation: ${profile.location || 'Ghana (remote)'}` +
          portfolioLine + linkedinLine,
        maxTokens: 700,
      });
      const match = result.text.match(/\{[\s\S]*\}/);
      emailDraft = match ? JSON.parse(match[0]) : null;
    } catch (err) {
      return { status: 'error', reason: `Cover email drafting failed: ${err.message}` };
    }

    if (!emailDraft?.subject || !emailDraft?.body) {
      return { status: 'error', reason: 'LLM returned invalid email draft — no subject or body.' };
    }

    // --- Step 3: Create approval task (gmail.sendEmail) ---
    const approvalTask = await this.createApprovalTask({
      instruction:
        `Send application email to ${applyEmail} — "${jobTitle}" at ${company}.\n\n` +
        `Subject: ${emailDraft.subject}\n\n` +
        `Preview:\n${emailDraft.body.slice(0, 400)}${emailDraft.body.length > 400 ? '…' : ''}\n\n` +
        `Review above, then click Approve to send from your Gmail.`,
      tool: 'gmail.sendEmail',
      payload: { to: applyEmail, subject: emailDraft.subject, body: emailDraft.body },
    });

    return {
      status: 'awaiting_approval',
      approvalTaskId: approvalTask.id,
      applyEmail,
      applicationUrl,
    };
  }
}

module.exports = JobApplicationAgent;
