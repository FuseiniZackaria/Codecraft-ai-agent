const fs = require('fs');
const path = require('path');
const config = require('../config');
const { selectProvider } = require('./router');

const BUSINESS_JSON_PATH = path.join(__dirname, '..', 'config', 'business.json');

/**
 * businessProfileUpdater.js - lets the owner update their business.json
 * conversationally through the Chat page instead of hand-editing JSON.
 *
 * Design choices:
 *   - MERGES, never overwrites. The LLM is given the CURRENT profile and
 *     told to only change fields the new message actually provides
 *     information for - saying "our hours are 9-5" must never blank out
 *     the pricing/policies/FAQ someone already set up.
 *   - The response is sanitized against the EXISTING schema's keys only -
 *     the LLM can never invent a new top-level field that nothing else in
 *     the codebase knows how to read.
 *   - Retries with a progressively larger token budget if the response gets
 *     cut off mid-JSON (same pattern CodingAgent already uses) - a profile
 *     with a real, multi-entry FAQ array can genuinely need more room than
 *     a short "our hours are 9-5" update does, so a fixed small budget was
 *     silently truncating larger updates into invalid JSON.
 *   - Writes to disk (survives a restart) AND mutates the same in-memory
 *     config.business object in place (not a reference replacement) - other
 *     modules like businessContextLine() and autoReplySafety hold onto that
 *     object directly, so replacing the reference wouldn't propagate,
 *     while mutating it takes effect immediately without a server restart.
 */
async function updateBusinessProfileFromMessage(message) {
  const current = { ...config.business };
  const provider = selectProvider({});

  const systemPrompt =
    'You maintain a structured business profile for an AI assistant. Given the CURRENT profile JSON and a ' +
    'new message from the business owner describing their business, output an UPDATED profile JSON with the ' +
    'EXACT same top-level keys as the current profile - never add, rename, or remove keys. Only change or add ' +
    'values for fields the new message actually gives information for - never blank out, remove, or guess at ' +
    'fields the message does not mention; leave everything else exactly as it was. If the message adds a new ' +
    'FAQ item, append it to the faq array without removing existing entries. Respond with ONLY the updated ' +
    'JSON object, no explanation, no markdown fences.';
  const prompt = `Current profile:\n${JSON.stringify(current, null, 2)}\n\nNew message from the owner:\n"${message}"`;

  // Escalating token budgets - a short update needs little room, but a
  // profile with a real FAQ array can genuinely need much more. Retrying
  // instead of failing outright on the first truncation.
  const tokenBudgets = [1500, 4000, 8000];
  let updated = null;
  let lastRawText = '';

  for (let attempt = 0; attempt < tokenBudgets.length; attempt++) {
    const result = await provider.complete({ maxTokens: tokenBudgets[attempt], system: systemPrompt, prompt });
    lastRawText = result.text;

    if (result.truncated) {
      console.warn(`[businessProfileUpdater] response truncated at maxTokens=${tokenBudgets[attempt]} - retrying with a larger budget`);
      continue;
    }

    try {
      const cleaned = result.text.replace(/```json|```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      updated = match ? JSON.parse(match[0]) : null;
      if (updated) break;
    } catch {
      // Not truncated per the API, but still didn't parse - try again with
      // more room in case it's a borderline case the token count doesn't
      // perfectly capture, rather than failing on the first attempt.
    }
  }

  if (!updated || typeof updated !== 'object') {
    throw new Error(
      `could not parse the updated business profile after ${tokenBudgets.length} attempts - the response may be too large for a single update. Try sending it in smaller pieces (e.g. a few FAQ items at a time). Last response started with: "${lastRawText.slice(0, 150)}"`
    );
  }

  // Sanitize against the EXISTING schema only - the model can adjust
  // values for known fields, but can never introduce a new top-level key.
  const allowedKeys = Object.keys(current);
  const sanitized = {};
  for (const key of allowedKeys) {
    sanitized[key] = updated[key] !== undefined ? updated[key] : current[key];
  }

  fs.writeFileSync(BUSINESS_JSON_PATH, JSON.stringify(sanitized, null, 2));

  // Mutate the SAME object in place, not a reference swap.
  Object.keys(config.business).forEach((k) => delete config.business[k]);
  Object.assign(config.business, sanitized);

  const changedFields = allowedKeys.filter((k) => JSON.stringify(current[k]) !== JSON.stringify(sanitized[k]));

  return { updated: sanitized, changedFields };
}

module.exports = { updateBusinessProfileFromMessage };