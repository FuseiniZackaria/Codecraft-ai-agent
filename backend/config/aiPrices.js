/**
 * AI prices used for ESTIMATED costs (usage tracking, spending caps, Ian's
 * daily cap). USD per million tokens. Prices change - check the providers'
 * pricing pages and edit here; nothing else needs to change.
 *   Anthropic: https://www.anthropic.com/pricing
 *   Google Gemini: https://ai.google.dev/gemini-api/docs/pricing
 *
 * Prompt-cache reads cost ~10% of normal input; cache writes ~1.25x.
 * A model missing from this table is counted at $0 (and logged once).
 * Gemini's free tier costs nothing; these are the paid-tier rates so caps
 * still mean something if billing is on.
 */
module.exports = {
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 }, // fallback model
  'claude-sonnet-5-5': { input: 2.0, output: 10.0 },
  'claude-opus-5-5': { input: 4.0, output: 20.0 },
  'claude-haiku-5-5': { input: 0.10, output: 0.50 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-opus-5': { input: 5.0, output: 25.0 }, // possible refusal-fallback model
  'claude-opus-4-8': { input: 5.0, output: 25.0 }, // possible refusal-fallback model
  'claude-sonnet-5': { input: 2.0, output: 10.0 }, // kept for compat
};
