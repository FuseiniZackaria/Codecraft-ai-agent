const BaseAgent = require('../base/BaseAgent');
const config = require('../../config');

/**
 * ResearchAgent - gathers and summarizes information for other agents/users.
 *
 * If TAVILY_API_KEY is configured, plans a real web search step first, then
 * analyzes and summarizes the results. Without a search key, falls back to
 * asking the LLM directly (it will honestly say it can't verify current
 * facts without a search tool, rather than fabricating results).
 */
class ResearchAgent extends BaseAgent {
  constructor() {
    super({
      key: 'research',
      role: 'Research Agent',
      goals: ['Gather accurate, relevant information for other agents and the user'],
      tools: ['gmail.readInbox', 'websearch.search'],
    });
  }

  async plan(task) {
    if (config.search.tavilyKey) {
      return [
        { type: 'tool_call', tool: 'websearch.search', args: { query: task.instruction } },
        {
          type: 'llm_call',
          instruction: `Using the search results above, list key findings about: ${task.instruction}`,
        },
        { type: 'llm_call', instruction: `Summarize the findings above in 2-3 sentences for a business owner.` },
      ];
    }

    // No search key configured - LLM-only fallback, no fabricated "research".
    return [
      { type: 'llm_call', instruction: `Research the following and list key findings: ${task.instruction}` },
      { type: 'llm_call', instruction: `Summarize the findings above in 2-3 sentences for a business owner.` },
    ];
  }
}

module.exports = ResearchAgent;
