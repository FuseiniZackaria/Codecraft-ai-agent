const store = require('./store');
const { fetchJson, fetchText, jsonLdBlocks, collectProducts, availability, num } = require('./importers');

/**
 * Live stock check before the agent talks about a product.
 *
 * Only products imported from a website that publishes stock (Shopify,
 * WooCommerce, schema.org) are re-checked - at most MAX_CHECKS per message,
 * each with a short timeout, and not more than once per CACHE_MS. CSV and
 * hand-entered products use their saved stock; services are always available.
 * If a check fails, the saved value is kept (and "unknown" stays unknown, so
 * the agent never promises it).
 */

const CACHE_MS = 10 * 60 * 1000;
const MAX_CHECKS = 3;
const TIMEOUT_MS = 4000;

async function liveStatus(p) {
  const ext = String(p.external_id || '');
  if (ext.startsWith('shopify:') && p.product_url) {
    const json = await fetchJson(`${p.product_url}.js`, { timeoutMs: TIMEOUT_MS });
    if (!json) return null;
    const variants = json.variants || [];
    return { stock_status: json.available || variants.some((v) => v.available) ? 'in_stock' : 'out_of_stock', price: num(json.price) != null ? num(json.price) / 100 : p.price };
  }
  if (ext.startsWith('woo:') && p.product_url) {
    const json = await fetchJson(`${new URL(p.product_url).origin}/wp-json/wc/store/v1/products/${ext.slice(4)}`, { timeoutMs: TIMEOUT_MS });
    if (!json) return null;
    return {
      stock_status: json.is_in_stock === false ? 'out_of_stock' : json.is_in_stock ? 'in_stock' : 'unknown',
      stock_qty: json.low_stock_remaining ?? null,
    };
  }
  if (ext.startsWith('ld:') && p.product_url) {
    const page = await fetchText(p.product_url, { timeoutMs: TIMEOUT_MS });
    if (!page.ok) return null;
    const product = collectProducts(jsonLdBlocks(page.text))[0];
    if (!product) return null;
    return { stock_status: availability([].concat(product.offers || [])[0]) };
  }
  return null; // page-text items, CSV, manual: nothing live to check
}

/** Refresh stock for the products about to be shown to the agent. Never throws. */
async function refresh(workspaceId, products) {
  const due = products
    .filter((p) => p.source === 'website' && p.stock_status !== 'always_available'
      && (!p.stock_checked_at || Date.now() - new Date(p.stock_checked_at).getTime() > CACHE_MS))
    .slice(0, MAX_CHECKS);
  if (!due.length) return products;
  const updates = new Map();
  await Promise.all(due.map(async (p) => {
    try {
      const live = await liveStatus(p);
      const fields = { stock_checked_at: new Date().toISOString(), ...(live || {}) };
      const saved = await store.updateProduct(workspaceId, p.id, fields);
      if (saved) updates.set(p.id, saved);
    } catch (err) {
      console.warn(`[catalog] live stock check failed for "${p.name}": ${err.message}`);
    }
  }));
  return products.map((p) => (updates.has(p.id) ? { ...p, ...updates.get(p.id) } : p));
}

module.exports = { refresh, liveStatus, CACHE_MS, MAX_CHECKS };
