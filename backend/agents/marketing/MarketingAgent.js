const BaseAgent = require('../base/BaseAgent');
const config = require('../../config');

/**
 * MarketingAgent - drafts marketing content (social posts, ad copy, email
 * campaign copy, taglines). Unlike Sales/Support/PersonalAssistant, nothing
 * here sends anywhere or needs approval - it just produces text, same
 * pattern as ResearchAgent. The output shows up directly in chat/Tasks.
 */
class MarketingAgent extends BaseAgent {
  constructor() {
    super({
      key: 'marketing',
      role: 'Marketing Agent',
      goals: ['Draft compelling, on-brand marketing content - social posts, ad copy, campaigns'],
      tools: ['websearch.search'],
    });
  }

  async plan(task) {
    const draftInstruction =
      `${task.instruction}\n\n` +
      'Draft this content ready to use - real copy, not a generic outline or placeholder text. ' +
      'Match a tone that fits the business context. If a platform/format is implied (Instagram, ' +
      'LinkedIn, email subject line, etc.), respect its normal length and style conventions.';

    if (config.search.tavilyKey) {
      return [
        { type: 'tool_call', tool: 'websearch.search', args: { query: task.instruction, maxResults: 5 } },
        { type: 'llm_call', maxTokens: 1200, instruction: draftInstruction },
      ];
    }

    return [{ type: 'llm_call', maxTokens: 1200, instruction: draftInstruction }];
  }
}

module.exports = MarketingAgent;
