const config = require('../config');
const mockProvider = require('./providers/mockProvider');
const aiProvider = require('./providers/aiProvider');

/**
 * Router picks which LLM provider handles a given task.
 * Falls back to the mock provider whenever no real key is configured, so the
 * whole pipeline stays runnable without external credentials.
 */
const registry = {
  mock: mockProvider,
  ai: aiProvider,
};

function availableProviders() {
  const available = ['mock'];
  if (config.llm.aiApiKey) available.push('ai');
  // additional providers would be added here the same way.
  return available;
}

function score(providerName, task) {
  const provider = registry[providerName];
  const weights = { capability: 0.5, cost: 0.3, speed: 0.2 };
  const capability = providerName === 'mock' ? 0.2 : 0.9; // real models score higher
  const costScore = 1 / (1 + provider.costPerCall);
  const speedScore = provider.speed === 'instant' ? 1 : 0.7;
  return weights.capability * capability + weights.cost * costScore + weights.speed * speedScore;
}

/**
 * @param {object} task - task object, may include `overrideProvider`
 * @returns provider adapter to use
 */
function selectProvider(task = {}) {
  if (task.overrideProvider && registry[task.overrideProvider]) {
    return registry[task.overrideProvider];
  }
  const candidates = availableProviders();
  const best = candidates.sort((a, b) => score(b, task) - score(a, task))[0];
  return registry[best];
}

module.exports = { selectProvider, availableProviders };
