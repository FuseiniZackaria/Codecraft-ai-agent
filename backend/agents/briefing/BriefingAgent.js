const BaseAgent = require('../base/BaseAgent');
const { selectProvider } = require('../../core/router');
const memory = require('../../memory');
const { buildBriefingReport } = require('../../core/briefing/reportBuilder');
const whatsapp = require('../../core/whatsappProvider');
/**
 * BriefingAgent - multi-source aggregation: combines several web searches
 * and/or specific named pages into ONE synthesized, cited brief, instead of
 * answering each source separately.
 *
 * MEMORY ACROSS RUNS: before planning, looks up the most recent prior run
 * saved under the EXACT SAME goal text (memory.getLatestBriefingRun) - this
 * is what turns a scheduled daily/weekly briefing into an actual trend
 * tool rather than a fresh, isolated snapshot every time. If a prior run
 * exists, its output is embedded directly into the final synthesis
 * instruction so the model can explicitly call out what's new, changed, or
 * escalating - not silently repeat itself. After a run completes,
 * reflect() (overridden below) saves ITS output for the next run to
 * compare against, keyed by the same exact goal string, AND generates a
 * formatted, cited .docx report file (core/briefing/reportBuilder.js).
 */
class BriefingAgent extends BaseAgent {
  constructor() {
    super({
      key: 'briefing',
      role: 'Briefing Agent',
      goals: ['Combine multiple sources (searches and/or specific pages) into a single, well-rounded, cited brief, tracking what changes across recurring runs'],
      tools: ['websearch.search', 'browser.navigate', 'browser.readPage'],
    });
  }

  static MAX_TOPICS = 5;
  static MAX_URLS = 5;
  static MAX_PRIOR_OUTPUT_CHARS = 6000;

  async plan(task) {
    let priorRun = null;
    try {
      priorRun = await memory.getLatestBriefingRun(task.instruction);
    } catch (err) {
      console.warn(`[BriefingAgent] failed to look up prior run: ${err.message}`);
    }

    let extracted = null;
    try {
      const provider = selectProvider({});
      const result = await provider.complete({
        maxTokens: 400,
        system:
          'Figure out what topics and/or specific sources the user wants combined into one brief. Respond ' +
          'with ONLY a JSON object: {"topics": ["...", "..."], "sourceUrls": ["...", "..."]}. "topics" are ' +
          'general subjects/issues/keywords to search the web for (each becomes its own search) - e.g. ' +
          '"healthcare policy", "the election", "inflation news". "sourceUrls" are specific named websites the ' +
          'user explicitly wants checked directly (add "https://" if a bare domain was given). Include EITHER ' +
          'or BOTH depending on what the user asked for. If the user gave a single broad ask like "daily brief ' +
          'on politics", break it into 2-4 sensible, distinct topics rather than one vague search. Never invent ' +
          'more than 5 topics or 5 source URLs even if more seem relevant - pick the most important ones.',
        prompt: `Current message: ${task.instruction}`,
      });
      const match = result.text.match(/\{[\s\S]*\}/);
      extracted = match ? JSON.parse(match[0]) : null;
    } catch (err) {
      console.warn(`[BriefingAgent] extraction failed: ${err.message}`);
    }

    const topics = Array.isArray(extracted?.topics) ? extracted.topics.filter((t) => typeof t === 'string' && t.trim()).slice(0, BriefingAgent.MAX_TOPICS) : [];
    const sourceUrls = Array.isArray(extracted?.sourceUrls) ? extracted.sourceUrls.filter((u) => typeof u === 'string' && u.trim()).slice(0, BriefingAgent.MAX_URLS) : [];

    // Stashed on the task object (in-memory only, for the duration of this
    // run) so reflect() can correctly tag each collected article with
    // which topic's search actually surfaced it - results[] preserves the
    // same order plan() pushed steps in, so results[i] <-> topics[i] for
    // the topic-search steps specifically.
    task.extractedTopics = topics;

    if (topics.length === 0 && sourceUrls.length === 0) {
      return [
        {
          type: 'llm_call',
          maxTokens: 200,
          instruction: `Ask the user which specific topics or which specific websites they want combined into a brief - could not tell from: "${task.instruction}".`,
        },
      ];
    }

    const steps = [];

    for (const topic of topics) {
      steps.push({ type: 'tool_call', tool: 'websearch.search', args: { query: topic, maxResults: 5 } });
    }

    for (const url of sourceUrls) {
      steps.push({ type: 'tool_call', tool: 'browser.navigate', args: { url } });
      steps.push({ type: 'tool_call', tool: 'browser.readPage', args: {} });
    }

    const priorContextLine = priorRun
      ? `\n\nFor reference, here is the PREVIOUS brief generated for this exact same request, from ${priorRun.createdAt}:\n"""\n${priorRun.output.slice(0, BriefingAgent.MAX_PRIOR_OUTPUT_CHARS)}\n"""\nCompare the current sources against this previous brief. Explicitly call out what is NEW, ` +
        `CHANGED, ESCALATING, or RESOLVED since then - don't just restate the previous brief or silently repeat ` +
        `the same points. If nothing meaningful has actually changed, say so honestly (e.g. "no significant ` +
        `developments since the last update") rather than manufacturing false novelty just to seem current.`
      : '';

    steps.push({
      type: 'llm_call',
      maxTokens: 6000,
      instruction:
        'The context above contains results from multiple separate searches and/or page reads, one after ' +
        'another - each search result is a JSON object with "answer" and "results" (title/url/content per ' +
        'match); each page read is a JSON object with "url"/"title"/"text". Combine ALL of this into ONE ' +
        'single, well-organized brief for the user - do not answer each source separately or list them one by ' +
        'one as isolated blocks. Organize by topic/theme where multiple sources touch the same subject, note ' +
        'where sources agree or disagree, and clearly distinguish factual reporting from opinion/commentary ' +
        'where that distinction is visible in the source content. Cite the specific source (title and/or ' +
        'domain) next to each claim rather than presenting it as your own general knowledge. If a search or ' +
        'page read failed or came back empty, mention that briefly rather than silently omitting it. Never ' +
        'fabricate a source, quote, or detail not actually present in the context above. Formatting: separate ' +
        'each distinct point or topic with a blank line between paragraphs; if the brief covers more than one ' +
        'topic, start each topic\'s paragraph with a short label in double asterisks, like "**Healthcare ' +
        'Policy**: According to..." - this exact convention is what turns the brief into a properly formatted, ' +
        'sectioned report document, not just a wall of text.' +
        priorContextLine,
    });

    return steps;
  }

  /**
   * Pulls every real {title, url} pair out of the raw tool_call results
   * from this run - the search/page-read steps' RAW return objects (not
   * the final synthesized text), deduplicated by URL. This is what makes
   * the report's "Sources" section a real, verifiable list rather than
   * whatever citations happened to survive into the model's prose.
   */
  extractSources(results) {
    const sources = [];
    const seen = new Set();
    for (const r of results) {
      if (!r || typeof r !== 'object') continue;
      if (Array.isArray(r.results)) {
        // websearch.search shape: { answer, results: [{title, url, content}] }
        for (const item of r.results) {
          if (item?.url && !seen.has(item.url)) {
            seen.add(item.url);
            sources.push({ title: item.title || item.url, url: item.url });
          }
        }
      } else if (typeof r.url === 'string' && r.url) {
        // browser.readPage shape: { url, title, text }
        if (!seen.has(r.url)) {
          seen.add(r.url);
          sources.push({ title: r.title || r.url, url: r.url });
        }
      }
    }
    return sources;
  }

  /**
   * Separate from extractSources() deliberately - that method builds the
   * REPORT's citation list (ephemeral, per-document). This builds records
   * for the DASHBOARD's persistent cross-run history: each individual
   * article, tagged with which topic's search surfaced it (using
   * task.extractedTopics, stashed by plan()) and a content snippet for the
   * dashboard's "latest news" summary. Deduplicates by URL WITHIN this
   * single run - cross-run/cross-day dedup is handled at the database
   * level by the unique index on (workflow_goal, url, collected_date).
   */
  extractArticles(task, results) {
    const topics = task.extractedTopics || [];
    const articles = [];
    const seen = new Set();

    function domainOf(url) {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
    }

    results.forEach((r, index) => {
      if (!r || typeof r !== 'object') return;

      if (Array.isArray(r.results)) {
        // websearch.search shape - index into topics[] lines up because
        // plan() pushes one search step per topic, in order, before any
        // other step type.
        const topic = topics[index] || null;
        for (const item of r.results) {
          if (item?.url && !seen.has(item.url)) {
            seen.add(item.url);
            articles.push({
              workflowGoal: task.instruction,
              topic,
              title: item.title || item.url,
              url: item.url,
              sourceDomain: domainOf(item.url),
              summary: item.content ? item.content.slice(0, 500) : null,
            });
          }
        }
      } else if (typeof r.url === 'string' && r.url) {
        // browser.readPage shape - not tied to a "topic" search, so left null.
        if (!seen.has(r.url)) {
          seen.add(r.url);
          articles.push({
            workflowGoal: task.instruction,
            topic: null,
            title: r.title || r.url,
            url: r.url,
            sourceDomain: domainOf(r.url),
            summary: r.text ? r.text.slice(0, 500) : null,
          });
        }
      }
    });

    return articles;
  }

  async reflect(task, results) {
    const note = await super.reflect(task, results);

    const finalResult = results[results.length - 1];
    const outputText = finalResult?.text;
    if (outputText) {
      try {
        await memory.saveBriefingRun({ goal: task.instruction, output: outputText });
      } catch (err) {
        console.warn(`[BriefingAgent] failed to save run for future comparison: ${err.message}`);
      }

      try {
        const sources = this.extractSources(results);
        const reportPath = await buildBriefingReport({
          goal: task.instruction,
          briefText: outputText,
          sources,
          generatedAt: new Date(),
        });
        // Mutating the final result's text here is deliberate and safe -
        // reflect() runs before run() returns results to the caller, so
        // this note reaches the user through the exact same path the
        // chat text already does (chat.js reads the last step with a
        // .text field), no new wiring needed.
        finalResult.text = `${outputText}\n\n---\n📄 A formatted report with full source citations has been saved to: ${reportPath}`;
      } catch (err) {
        console.warn(`[BriefingAgent] failed to generate report file: ${err.message}`);
      }

           try {
        const articles = this.extractArticles(task, results);
        if (articles.length > 0) {
          await memory.saveBriefingArticles(articles);
        }
      } catch (err) {
        console.warn(`[BriefingAgent] failed to save articles for dashboard: ${err.message}`);
      }

      try {
        await this.deliverIfConfigured(task.instruction, outputText);
      } catch (err) {
        console.warn(`[BriefingAgent] WhatsApp delivery failed: ${err.message}`);
      }
    }

    return note;
  }

  /**
   * WhatsApp delivery is opt-in PER WORKFLOW, matched by the same exact
   * goal-text key briefing_runs/briefing_articles already use - the
   * scheduler doesn't attach a workflowId to the task it creates
   * (core/scheduler.js calls orchestrator.submitGoal(workflow.goal) with
   * just the string), so exact-goal matching is the only link available
   * without deeper plumbing changes elsewhere.
   *
   * Deliberately calls whatsappProvider directly rather than going through
   * a tool_call step - a tool_call for an irreversible tool would trigger
   * BaseAgent's automatic approval-gate deferral, but this needs to send
   * immediately, without a human in the loop, for a workflow the user has
   * ALREADY explicitly opted into. Same precedent as the existing
   * autoReply.telegram/whatsapp.enabled flags elsewhere in this codebase -
   * auto-send is only ever available behind an explicit, per-target opt-in,
   * never a default.
   */
  async deliverIfConfigured(goal, briefText) {
    const workflows = await memory.listWorkflows();
    const matching = workflows.find((w) => w.goal === goal);
    if (!matching?.deliverWhatsappEnabled || !matching?.deliverWhatsappTo) return;

    const MAX_DIGEST_CHARS = 1000;
    const truncated = briefText.length > MAX_DIGEST_CHARS;
    const digest = truncated ? `${briefText.slice(0, MAX_DIGEST_CHARS)}...` : briefText;
    const message = `📰 ${goal}\n\n${digest}${truncated ? '\n\n(Full report saved - see the Intelligence dashboard for the complete version.)' : ''}`;

    await whatsapp.sendMessage(matching.deliverWhatsappTo, message);
  }
}

module.exports = BriefingAgent;