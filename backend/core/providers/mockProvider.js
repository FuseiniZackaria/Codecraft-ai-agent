/**
 * MockProvider
 *
 * Stand-in LLM adapter used when no real provider key is configured, so the
 * orchestrator/agent pipeline is runnable and testable out of the box.
 * Real adapters (openaiProvider.js, aiProvider.js, ...) implement the
 * same `complete({ prompt, system }) -> { text, provider, costEstimate }` interface.
 */
module.exports = {
  name: 'mock',
  costPerCall: 0,
  speed: 'instant',

  async complete({ prompt, content }) {
    const preview = prompt ? prompt.slice(0, 120) : '[attachment(s) - mock provider cannot see file content]';
    return {
      provider: 'mock',
      text: `[mock response] Task understood: "${preview}". ` +
            `(Configure OPENAI_API_KEY or AI_API_KEY to use a real model.)`,
      costEstimate: 0,
    };
  },
};
