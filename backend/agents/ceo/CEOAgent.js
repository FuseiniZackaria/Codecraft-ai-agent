const BaseAgent = require('../base/BaseAgent');
const config = require('../../config');

/**
 * CEOAgent - business strategy thinking partner. Unlike ResearchAgent (finds
 * facts) or MarketingAgent (drafts content), this reasons through tradeoffs
 * given the business's actual context/constraints and commits to a clear
 * recommendation, not just a list of options. No send action, no approval
 * needed - just delivers the analysis, same pattern as Research/Marketing.
 */
class CEOAgent extends BaseAgent {
  constructor() {
    super({
      key: 'ceo',
      role: 'CEO Agent',
      goals: ['Think through strategy, priorities, and tradeoffs like a co-founder would'],
      tools: ['websearch.search'],
    });
  }

  async plan(task) {
    const strategyInstruction =
      `${task.instruction}\n\n` +
      'Think through this like a co-founder, not a consultant - consider the constraints of a small, ' +
      'resource-limited business (limited time, budget, team). Weigh the real tradeoffs honestly, ' +
      'including ones the question didn\'t ask about if they matter. End with a clear recommendation, ' +
      'not just a list of options - say what you\'d actually do and why.';

    if (config.search.tavilyKey) {
      return [
        { type: 'tool_call', tool: 'websearch.search', args: { query: task.instruction, maxResults: 5 } },
        { type: 'llm_call', maxTokens: 1500, instruction: strategyInstruction },
      ];
    }

    return [{ type: 'llm_call', maxTokens: 1500, instruction: strategyInstruction }];
  }
}

module.exports = CEOAgent;
