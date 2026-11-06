/**
 * Getting products in: CSV/Excel upload and website import.
 *
 * Website import tries, in order (first one that finds items wins):
 *   1. Shopify          {site}/products.json
 *   2. WooCommerce      {site}/wp-json/wc/store/v1/products
 *   3. Structured data  schema.org Product / ItemList in the page (JSON-LD)
 *   4. Page text        any normal site (e.g. a services site): the visible text
 *                       is read and Claude lists the products/services it offers
 *                       (one AI call per sync).
 * Every item gets an external_id so a re-sync updates it instead of adding a copy.
 */

const UA = 'Mozilla/5.0 (compatible; CodeCraftCatalogBot/1.0)';
const MAX_ITEMS = 1000;

async function fetchText(url, { timeoutMs = 15000, accept = 'text/html,application/json' } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, type: res.headers.get('content-type') || '' };
}
async function fetchJson(url, opts) {
  const r = await fetchText(url, { ...opts, accept: 'application/json' });
  if (!r.ok) return null;
  try { return JSON.parse(r.text); } catch { return null; }
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function normaliseUrl(input) {
  let u = String(input || '').trim();
  if (!u) throw Object.assign(new Error('Enter the website address.'), { code: 'INVALID' });
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  let parsed;
  try { parsed = new URL(u); } catch { throw Object.assign(new Error(`"${input}" isn't a valid website address.`), { code: 'INVALID' }); }
  // Only public websites (tests run a fake shop on this computer, so they may use 127.0.0.1).
  const local = /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(parsed.hostname);
  if (local && process.env.CC_TESTING === '1') return parsed.toString().replace(/\/$/, '');
  if (!/\./.test(parsed.hostname) || local) {
    throw Object.assign(new Error('Use a public website address.'), { code: 'INVALID' });
  }
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

// ---------- 1. Shopify ----------
async function fromShopify(site) {
  const origin = new URL(site).origin;
  const json = await fetchJson(`${origin}/products.json?limit=250`).catch(() => null);
  if (!json || !Array.isArray(json.products) || !json.products.length) return null;
  return json.products.slice(0, MAX_ITEMS).map((p) => {
    const variants = p.variants || [];
    const anyAvailable = variants.some((v) => v.available !== false);
    return {
      external_id: `shopify:${p.id}`,
      name: p.title,
      description: stripHtml(p.body_html).slice(0, 1000) || null,
      category: p.product_type || null,
      price: num(variants[0]?.price),
      stock_status: variants.length ? (anyAvailable ? 'in_stock' : 'out_of_stock') : 'unknown',
      image_url: p.images?.[0]?.src || p.image?.src || null,
      product_url: `${origin}/products/${p.handle}`,
      aliases: (p.tags ? String(p.tags) : '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8).join(', '),
    };
  });
}

// ---------- 2. WooCommerce (public Store API) ----------
async function fromWooCommerce(site) {
  const origin = new URL(site).origin;
  const json = await fetchJson(`${origin}/wp-json/wc/store/v1/products?per_page=100`).catch(() => null);
  if (!Array.isArray(json) || !json.length) return null;
  return json.slice(0, MAX_ITEMS).map((p) => {
    const minor = Number(p.prices?.currency_minor_unit ?? 2);
    const raw = num(p.prices?.price);
    return {
      external_id: `woo:${p.id}`,
      name: stripHtml(p.name),
      description: stripHtml(p.short_description || p.description).slice(0, 1000) || null,
      category: p.categories?.[0]?.name || null,
      price: raw == null ? null : raw / 10 ** minor,
      currency: p.prices?.currency_code || 'GHS',
      stock_status: p.is_in_stock === false ? 'out_of_stock' : p.is_in_stock ? 'in_stock' : 'unknown',
      stock_qty: p.low_stock_remaining ?? null,
      image_url: p.images?.[0]?.src || null,
      product_url: p.permalink || null,
    };
  });
}

// ---------- 3. schema.org JSON-LD ----------
function jsonLdBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1].trim())); } catch { /* skip broken blocks */ }
  }
  return out;
}
function collectProducts(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) { node.forEach((n) => collectProducts(n, found)); return found; }
  const type = [].concat(node['@type'] || []).map(String);
  if (type.includes('Product')) found.push(node);
  for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity']) collectProducts(node[key], found);
  return found;
}
function availability(offers) {
  const a = String(offers?.availability || '').toLowerCase();
  if (a.includes('instock') || a.includes('limitedavailability') || a.includes('onlineonly')) return 'in_stock';
  if (a.includes('outofstock') || a.includes('soldout') || a.includes('discontinued')) return 'out_of_stock';
  return 'unknown';
}
function productFromLd(p, site) {
  const offers = [].concat(p.offers || [])[0] || {};
  const image = [].concat(p.image || [])[0];
  const url = p.url || offers.url || null;
  return {
    external_id: `ld:${url || slug(p.name)}`,
    name: stripHtml(p.name),
    description: stripHtml(p.description).slice(0, 1000) || null,
    category: typeof p.category === 'string' ? p.category : null,
    price: num(offers.price ?? offers.lowPrice),
    currency: offers.priceCurrency || 'GHS',
    stock_status: availability(offers),
    image_url: typeof image === 'string' ? image : image?.url || null,
    product_url: url ? new URL(url, site).toString() : null,
  };
}
function fromStructuredData(html, site) {
  const items = collectProducts(jsonLdBlocks(html)).filter((p) => p.name).map((p) => productFromLd(p, site));
  return items.length ? items.slice(0, MAX_ITEMS) : null;
}

// ---------- 4. Page text + Claude ----------
async function renderedText(site) {
  // Plain fetch first; modern sites (React etc.) need a real browser to show their text.
  const plain = await fetchText(site).catch(() => null);
  const plainText = plain?.ok ? stripHtml(plain.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')) : '';
  if (plainText.length > 600) return { text: plainText, html: plain.text };
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ userAgent: UA });
      await page.goto(site, { waitUntil: 'networkidle', timeout: 30000 });
      const text = await page.evaluate(() => document.body.innerText);
      const html = await page.content();
      return { text: String(text || '').replace(/\n{2,}/g, '\n'), html };
    } finally {
      await browser.close();
    }
  } catch (err) {
    if (plainText) return { text: plainText, html: plain.text };
    throw new Error(`couldn't open the website (${err.message})`);
  }
}

async function fromPageText(text, site) {
  const { selectProvider } = require('../router');
  const result = await selectProvider({}).complete({
    maxTokens: 4000,
    system: 'You extract a business catalogue from website text. Only list items the text actually offers for sale or hire - never invent any. Answer with ONLY JSON.',
    prompt: `Website: ${site}\n\nVisible text:\n"""\n${text.slice(0, 20000)}\n"""\n\n` +
      'List every product or service this business sells. JSON: {"items": [{"name": "...", "type": "product" | "service", ' +
      '"description": "one or two sentences from the text", "category": "...", "price": number or null (only if the text states it), ' +
      '"currency": "GHS" or as stated}]}. Do not include testimonials, statistics, features or navigation links.',
  });
  const match = String(result.text || '').match(/\{[\s\S]*\}/);
  let items = [];
  try { items = JSON.parse(match ? match[0] : '{}').items || []; } catch { items = []; }
  return items.filter((i) => i && i.name).slice(0, 200).map((i) => ({
    external_id: `page:${slug(i.name)}`,
    name: String(i.name).slice(0, 200),
    description: i.description ? String(i.description).slice(0, 1000) : null,
    category: i.category ? String(i.category).slice(0, 100) : (i.type === 'service' ? 'Service' : null),
    price: num(i.price),
    currency: i.currency || 'GHS',
    // A service has no stock; a product found only in page text has no stock information.
    stock_status: i.type === 'service' ? 'always_available' : 'unknown',
    product_url: site,
  }));
}

/** Import a website. Returns { method, items }. */
async function importWebsite(input) {
  const site = normaliseUrl(input);
  const shopify = await fromShopify(site);
  if (shopify) return { site, method: 'shopify', items: shopify };
  const woo = await fromWooCommerce(site);
  if (woo) return { site, method: 'woocommerce', items: woo };
  const page = await renderedText(site);
  const ld = fromStructuredData(page.html || '', site);
  if (ld) return { site, method: 'structured-data', items: ld };
  const items = await fromPageText(page.text, site);
  return { site, method: 'page-text', items };
}

// ---------- CSV / Excel ----------
const COLUMN_NAMES = {
  name: ['name', 'product', 'product name', 'item', 'item name', 'title', 'service'],
  price: ['price', 'cost', 'amount', 'selling price', 'unit price', 'price (ghs)', 'price ghs'],
  stock_qty: ['stock', 'qty', 'quantity', 'in stock', 'stock qty', 'stock quantity', 'available', 'units'],
  description: ['description', 'details', 'desc', 'about'],
  category: ['category', 'type', 'group', 'section'],
  image_url: ['image', 'image url', 'image_url', 'photo', 'picture', 'image link'],
  product_url: ['url', 'link', 'product url', 'product link', 'website'],
  aliases: ['other names', 'aliases', 'also called', 'keywords', 'tags'],
  currency: ['currency'],
  sku: ['sku', 'code', 'id', 'product id', 'item code'],
};

/** Read a CSV/Excel file (base64). Returns { items, columns, skipped }. */
function parseSpreadsheet({ filename, data }) {
  const XLSX = require('xlsx');
  const buffer = Buffer.from(String(data || ''), 'base64');
  if (!buffer.length) throw Object.assign(new Error('The file is empty.'), { code: 'INVALID' });
  if (buffer.length > 5 * 1024 * 1024) throw Object.assign(new Error('The file is too big (max 5 MB).'), { code: 'INVALID' });
  const isCsv = /\.csv$/i.test(filename || '');
  const wb = isCsv ? XLSX.read(buffer.toString('utf8').replace(/^﻿/, ''), { type: 'string' }) : XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  if (!rows.length) throw Object.assign(new Error('No rows found - the first row should be the column names.'), { code: 'INVALID' });

  const headers = Object.keys(rows[0]);
  const columns = {};
  for (const [field, names] of Object.entries(COLUMN_NAMES)) {
    const h = headers.find((x) => names.includes(String(x).toLowerCase().trim()));
    if (h) columns[field] = h;
  }
  if (!columns.name) {
    throw Object.assign(new Error(`No "name" column found. Columns in your file: ${headers.join(', ')}. Name one of them "Name" (or "Product").`), { code: 'INVALID' });
  }
  const items = [];
  let skipped = 0;
  const seen = new Set();
  for (const r of rows.slice(0, MAX_ITEMS)) {
    const name = String(r[columns.name] || '').trim();
    if (!name) { skipped += 1; continue; }
    const ext = `csv:${columns.sku && r[columns.sku] ? String(r[columns.sku]).trim() : slug(name)}`;
    if (seen.has(ext)) { skipped += 1; continue; }
    seen.add(ext);
    const qtyText = columns.stock_qty ? String(r[columns.stock_qty]).trim().toLowerCase() : '';
    const qty = num(qtyText);
    let stock = 'unknown';
    if (/^(yes|y|true|in stock|available)$/.test(qtyText)) stock = 'in_stock';
    else if (/^(no|n|false|out|out of stock|sold out)$/.test(qtyText)) stock = 'out_of_stock';
    else if (qty !== null) stock = qty > 0 ? 'in_stock' : 'out_of_stock';
    items.push({
      external_id: ext,
      name: name.slice(0, 200),
      price: columns.price ? num(r[columns.price]) : null,
      currency: columns.currency && r[columns.currency] ? String(r[columns.currency]).trim().toUpperCase().slice(0, 5) : 'GHS',
      stock_status: stock,
      stock_qty: qty !== null && /^\d/.test(qtyText) ? Math.round(qty) : null,
      description: columns.description ? String(r[columns.description] || '').trim().slice(0, 1000) || null : null,
      category: columns.category ? String(r[columns.category] || '').trim().slice(0, 100) || null : null,
      image_url: columns.image_url ? String(r[columns.image_url] || '').trim() || null : null,
      product_url: columns.product_url ? String(r[columns.product_url] || '').trim() || null : null,
      aliases: columns.aliases ? String(r[columns.aliases] || '').trim().slice(0, 300) : '',
    });
  }
  return { items, columns, skipped, total: rows.length };
}

module.exports = {
  importWebsite, parseSpreadsheet, normaliseUrl, fromStructuredData, fromPageText, jsonLdBlocks, collectProducts, availability,
  fetchText, fetchJson, slug, num, COLUMN_NAMES,
};
