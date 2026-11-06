const store = require('./store');

/**
 * Finding products from what a customer wrote - misspellings, Pidgin and
 * local words included.
 *
 *   1. keep the meaningful words (drop filler, including Pidgin filler like
 *      "abeg", "chale", "dey", "wey");
 *   2. add the meaning of local words ("chalewote" -> slippers), from a small
 *      built-in Ghanaian list plus the business's own list (Products tab);
 *   3. spelling-tolerant search (Postgres pg_trgm; same idea in JS for tests).
 *
 * A small catalogue (up to INCLUDE_ALL active items) is sent to the agent in
 * full, so nothing can be missed; a bigger one is searched.
 */

const INCLUDE_ALL = 30;
const MAX_MATCHES = 6;

const FILLER = new Set(('a an and are as at be but by can could did do does for from had has have hello hi how i if in is it its ' +
  'me my no not of on or our please so than that the their them then there these they this to us was we were what when where ' +
  'which who why will with would you your yours good morning afternoon evening thanks thank okay ok want need looking look ' +
  'any some get got still any one ones price prices much cost sell sells selling buy available stock left ' +
  // Ghana Pidgin / common chat filler
  'abeg chale charley dey wey make una sef oo o ooo ein eh na wan go fit dem dis dat am e be bro sis boss please plz pls masa ' +
  'paa kraa saa ankasa').split(/\s+/));

// Built-in local words -> what to search for. The business can add its own.
const BUILT_IN_WORDS = {
  chalewote: 'slippers sandals', charlewote: 'slippers sandals', lappa: 'cloth fabric wrapper', ntoma: 'cloth fabric',
  ntama: 'cloth fabric', kaba: 'kaba dress blouse', slit: 'skirt', fugu: 'smock', batakari: 'smock', kente: 'kente cloth',
  shito: 'pepper sauce shito', paano: 'bread', nsuo: 'water', aduane: 'food', nkwan: 'soup', abenkwan: 'palm nut soup',
  kokonte: 'kokonte', 'pure water': 'sachet water', sachet: 'sachet water', phone: 'phone mobile', chop: 'food',
  chopbar: 'food', tro: 'transport', kenkey: 'kenkey', waakye: 'waakye', jollof: 'jollof rice', jolof: 'jollof rice',
};

function words(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .match(/[a-z0-9]+/g) || [];
}

/** Key words for searching, with local words expanded. */
function keyTerms(text, synonyms = []) {
  const lower = ` ${words(text).join(' ')} `;
  const extra = [];
  const local = { ...BUILT_IN_WORDS };
  for (const s of synonyms) local[String(s.term).toLowerCase().trim()] = String(s.means).toLowerCase();
  for (const [term, means] of Object.entries(local)) {
    if (lower.includes(` ${term} `)) extra.push(...words(means));
  }
  const kept = words(text).filter((w) => w.length >= 2 && !FILLER.has(w));
  return [...new Set([...kept, ...extra])];
}

// --- JS version of trigram similarity (used in tests / without a database) ---
function trigrams(word) {
  const s = `  ${word} `;
  const out = new Set();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}
function wordSim(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  let common = 0;
  for (const t of A) if (B.has(t)) common += 1;
  return common / (A.size + B.size - common);
}
/** How well a product matches the query words (0-1): every word of a name must find a close word in the query. */
function nameScore(name, queryWords) {
  const nameWords = words(name);
  if (!nameWords.length || !queryWords.length) return 0;
  const best = nameWords.map((n) => Math.max(...queryWords.map((q) => wordSim(n, q))));
  return best.reduce((s, x) => s + x, 0) / best.length;
}
// One close word is enough ("trowser" finds "Slim Black Trouser"): customers
// usually name one word of a product, often misspelt.
const WORD_MATCH = 0.42;
function bestWordScore(nameText, queryWords) {
  let best = 0;
  for (const n of words(nameText).filter((w) => w.length >= 4)) {
    for (const q of queryWords) best = Math.max(best, wordSim(n, q));
  }
  return best >= WORD_MATCH ? 0.4 + 0.5 * best : 0;
}
function fuzzyScore(product, query) {
  const q = words(query);
  const names = [product.name, ...String(product.aliases || '').split(',')].map((s) => s.trim()).filter(Boolean);
  let score = Math.max(...names.map((n) => nameScore(n, q)), bestWordScore(names.join(' '), q));
  const body = ` ${words(`${product.category || ''} ${product.description || ''}`).join(' ')} `;
  if (q.some((w) => w.length >= 4 && body.includes(` ${w}`))) score = Math.max(score, 0.5);
  return score;
}

function stockLine(p) {
  if (p.stock_status === 'always_available') return 'available (a service - no stock)';
  if (p.stock_status === 'in_stock') return p.stock_qty != null ? `in stock (${p.stock_qty} left)` : 'in stock';
  if (p.stock_status === 'out_of_stock') return 'OUT OF STOCK';
  return "stock unknown - don't say it's available; say a team member will confirm";
}
function priceLine(p) {
  if (p.price == null || p.price === '') return null;
  return `${p.currency || 'GHS'} ${Number(p.price).toLocaleString('en-GH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Products for one customer message, ready for the prompt.
 * @param {object} opts
 * @param {string} opts.message - what the customer wrote (or what their photo shows)
 * @param {string} [opts.previous] - their message before (follow-ups like "the red one")
 * @param {string[]} [opts.extraTerms] - words from a photo ("trouser", "black")
 * @returns {Promise<{products: Array, block: string}>}
 */
async function forMessage(workspaceId, { message = '', previous = '', extraTerms = [] } = {}) {
  if (!workspaceId) return { products: [], block: '' };
  let picked = [];
  try {
    const total = await store.countProducts(workspaceId);
    if (!total) return { products: [], block: '' };
    const synonyms = await store.listSynonyms(workspaceId).catch(() => []);
    const terms = keyTerms(`${message} ${previous} ${extraTerms.join(' ')}`, synonyms);
    if (total <= INCLUDE_ALL) {
      // Everything, best matches for this message (or photo) first.
      const all = await store.listProducts(workspaceId, { activeOnly: true, limit: INCLUDE_ALL });
      const q = terms.join(' ');
      picked = q ? all.map((p, i) => ({ p, i, s: fuzzyScore(p, q) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p) : all;
    } else {
      picked = terms.length ? await store.searchProducts(workspaceId, terms.join(' '), MAX_MATCHES) : [];
    }
  } catch (err) {
    if (err.code !== 'MIGRATION_MISSING') console.warn(`[catalog] product lookup failed for ${workspaceId}: ${err.message}`);
    return { products: [], block: '' };
  }

  // Live stock for the items being discussed (website items; cached briefly).
  picked = await require('./stock').refresh(workspaceId, picked).catch(() => picked);

  const products = picked.map((p, i) => ({ ...p, label: `P${i + 1}` }));
  if (!products.length) return { products, block: '' };
  const lines = products.map((p) => {
    const parts = [`[${p.label}] ${p.name}`];
    if (p.category) parts.push(`(${p.category})`);
    const price = priceLine(p);
    if (price) parts.push(`- ${price}`);
    parts.push(`- ${stockLine(p)}`);
    if (p.image_url) parts.push('- photo available');
    if (p.product_url) parts.push(`- link: ${p.product_url}`);
    if (p.aliases) parts.push(`- also called: ${p.aliases}`);
    return `${parts.join(' ')}${p.description ? `\n    ${String(p.description).slice(0, 300)}` : ''}`;
  });
  const block = 'Products and services the business sells (only these - never invent others, and never promise something that is out of stock or whose stock is unknown):\n'
    + `${lines.join('\n')}\n\n`;
  return { products, block };
}

module.exports = { forMessage, keyTerms, fuzzyScore, wordSim, BUILT_IN_WORDS, INCLUDE_ALL, MAX_MATCHES, stockLine, priceLine };
