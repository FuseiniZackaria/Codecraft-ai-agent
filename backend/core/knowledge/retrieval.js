const store = require('./store');

/**
 * Picks the knowledge the agent sees for one customer message.
 *
 * Q&A entries (switched on only):
 *   - a small set (up to INCLUDE_ALL entries / INCLUDE_ALL_CHARS characters)
 *     is sent in full - simplest and nothing gets missed;
 *   - a bigger set is searched (Postgres full-text search on the customer's
 *     message and the previous one) and the best MAX_QA matches are sent.
 *
 * Every entry gets a label ([Q1], [Q2], ...) so the agent can say which ones it
 * used. No paid "meaning" search: if this ever misses things, that's the
 * upgrade to consider.
 */

const INCLUDE_ALL = 25;
const INCLUDE_ALL_CHARS = 8000;
const MAX_QA = 8;

const STOP = new Set(('a an and are as at be but by can could did do does for from had has have hello hi how i if in is it its me my ' +
  'no not of on or our please so than that the their them then there these they this to us was we were what when where which ' +
  'who why will with would you your yours good morning afternoon evening thanks thank okay ok').split(' '));

/** Lower-case content words, with simple plural/-ing/-ed endings trimmed. */
function terms(text) {
  const out = new Set();
  for (const raw of String(text || '').toLowerCase().match(/[a-z0-9À-ɏ]+/g) || []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') || raw);
  }
  return [...out].filter((t) => t.length >= 3);
}

/** Same word, allowing different endings ("deliver"/"delivery", "price"/"pricing"). */
function sameWord(a, b) {
  if (a === b) return true;
  const n = Math.min(5, a.length, b.length);
  return n >= 4 && a.slice(0, n) === b.slice(0, n);
}

/** How well an entry matches: question words count double. */
function score(entry, queryTerms) {
  const q = terms(entry.question);
  const a = terms(entry.answer);
  let s = 0;
  for (const t of queryTerms) {
    if (q.some((w) => sameWord(w, t))) s += 2;
    else if (a.some((w) => sameWord(w, t))) s += 1;
  }
  return s;
}

/**
 * @param {string} workspaceId
 * @param {string} message - the customer's latest message
 * @param {string} [previous] - their message before that (helps short follow-ups like "and on Sunday?")
 * @returns {Promise<{qa: Array<{label, id, question, answer}>, block: string}>}
 */
async function forMessage(workspaceId, message, previous = '') {
  if (!workspaceId) return { qa: [], block: '' };
  let picked = [];
  try {
    const firstFew = await store.listQa(workspaceId, { enabledOnly: true, limit: INCLUDE_ALL + 1 });
    const chars = firstFew.reduce((n, e) => n + e.question.length + e.answer.length, 0);
    if (firstFew.length <= INCLUDE_ALL && chars <= INCLUDE_ALL_CHARS) {
      picked = firstFew.reverse(); // oldest first reads more naturally
    } else {
      const queryTerms = terms(`${message} ${previous}`);
      const candidates = await store.searchQa(workspaceId, queryTerms);
      picked = candidates
        .map((e) => ({ e, s: score(e, queryTerms) }))
        .filter((x) => x.s > 0)
        .sort((x, y) => y.s - x.s)
        .slice(0, MAX_QA)
        .map((x) => x.e);
    }
  } catch (err) {
    // No Q&A is better than no reply: the agent then holds anything it doesn't know.
    if (err.code !== 'MIGRATION_MISSING') console.warn(`[knowledge] Q&A lookup failed for ${workspaceId}: ${err.message}`);
    return { qa: [], block: '' };
  }

  const qa = picked.map((e, i) => ({ label: `Q${i + 1}`, id: e.id, question: e.question, answer: e.answer }));
  const block = qa.length
    ? 'Q&A from the business (approved answers - use them as the truth, in your own words):\n' +
      qa.map((e) => `[${e.label}] Q: ${e.question}\nA: ${e.answer}`).join('\n\n') + '\n\n'
    : '';
  return { qa, block };
}

module.exports = { forMessage, terms, score, INCLUDE_ALL, MAX_QA };
