const store = require('./store');
const importers = require('./importers');

/**
 * Products (Settings -> General -> Products): add/edit by hand, CSV/Excel
 * upload, website import with "Sync now" and a daily re-sync, and local
 * words for search. Everything is per workspace.
 */

const STOCK = ['in_stock', 'out_of_stock', 'unknown', 'always_available'];
const DAILY_MS = 24 * 60 * 60 * 1000;

function invalid(errors) {
  const err = new Error(errors.join(' '));
  err.code = 'INVALID';
  err.details = errors;
  return err;
}
function notFound(what) {
  const err = new Error(`That ${what} was not found.`);
  err.code = 'NOT_FOUND';
  return err;
}

const isHttpUrl = (s) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(s);

/** Checks a product from the form. partial = only the fields sent. */
function validate(input = {}, { partial = false } = {}) {
  const errors = [];
  const v = {};
  const str = (k, max) => {
    if (input[k] === undefined) return;
    const s = input[k] === null ? '' : String(input[k]).trim();
    if (s.length > max) errors.push(`${k.replace('_', ' ')} is too long (max ${max} characters).`);
    else v[k] = s || null;
  };
  if (!partial || input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (!name) errors.push('The name can\'t be empty.');
    else if (name.length > 200) errors.push('The name is too long (max 200 characters).');
    else v.name = name;
  }
  str('description', 2000);
  str('category', 100);
  if (input.aliases !== undefined) v.aliases = String(input.aliases || '').split(',').map((s) => s.trim()).filter(Boolean).join(', ').slice(0, 500);
  if (input.price !== undefined) {
    if (input.price === null || input.price === '') v.price = null;
    else if (!Number.isFinite(Number(input.price)) || Number(input.price) < 0) errors.push('The price must be a number (or empty).');
    else v.price = Math.round(Number(input.price) * 100) / 100;
  }
  if (input.currency !== undefined) v.currency = String(input.currency || 'GHS').trim().toUpperCase().slice(0, 5) || 'GHS';
  if (input.stock_status !== undefined) {
    if (!STOCK.includes(input.stock_status)) errors.push('Stock must be one of: in stock, out of stock, unknown, always available.');
    else v.stock_status = input.stock_status;
  }
  if (input.stock_qty !== undefined) {
    if (input.stock_qty === null || input.stock_qty === '') v.stock_qty = null;
    else if (!Number.isInteger(Number(input.stock_qty)) || Number(input.stock_qty) < 0) errors.push('The quantity must be a whole number (or empty).');
    else v.stock_qty = Number(input.stock_qty);
  }
  for (const k of ['image_url', 'product_url']) {
    if (input[k] === undefined) continue;
    const s = String(input[k] || '').trim();
    if (s && !isHttpUrl(s)) errors.push(`${k === 'image_url' ? 'The photo' : 'The link'} must be a web address starting with http:// or https://`);
    else v[k] = s || null;
  }
  if (input.active !== undefined) v.active = !!input.active;
  // A quantity decides in/out of stock when it's given.
  if (v.stock_qty != null && v.stock_status === undefined) v.stock_status = v.stock_qty > 0 ? 'in_stock' : 'out_of_stock';
  return { value: v, errors };
}

async function create(workspaceId, input) {
  const { value, errors } = validate(input);
  if (errors.length) throw invalid(errors);
  return store.createProduct(workspaceId, { ...value, source: 'manual' });
}

async function update(workspaceId, id, input) {
  const { value, errors } = validate(input, { partial: true });
  if (errors.length) throw invalid(errors);
  if (!Object.keys(value).length) throw invalid(['Nothing to change.']);
  const saved = await store.updateProduct(workspaceId, id, value);
  if (!saved) throw notFound('product');
  return saved;
}

async function remove(workspaceId, id) {
  if (!(await store.deleteProduct(workspaceId, id))) throw notFound('product');
}

/** CSV / Excel upload: adds new rows, updates ones already imported from a file, leaves the rest alone. */
async function importSpreadsheet(workspaceId, file) {
  const parsed = importers.parseSpreadsheet(file || {});
  if (!parsed.items.length) throw invalid(['No products found in the file.']);
  const result = await store.upsertFromSource(workspaceId, { source: 'csv', items: parsed.items, keepMissing: true });
  return { ...result, removed: 0, skipped: parsed.skipped, columns: parsed.columns };
}

/** Import (or re-sync) one website. Never throws for site problems - the outcome is saved on the source. */
async function syncSource(workspaceId, sourceId) {
  const source = await store.getSource(workspaceId, sourceId);
  if (!source) throw notFound('website');
  await store.updateSource(workspaceId, sourceId, { last_status: 'running', last_error: null });
  try {
    const { method, items } = await importers.importWebsite(source.url);
    if (!items.length) throw new Error("no products or services were found on that page - try the page that lists them (e.g. /shop or /services)");
    const counts = await store.upsertFromSource(workspaceId, { source: 'website', sourceId, items });
    const saved = await store.updateSource(workspaceId, sourceId, {
      last_status: 'ok', last_error: null, last_method: method, item_count: items.length, last_synced_at: new Date().toISOString(),
    });
    return { source: saved, method, ...counts };
  } catch (err) {
    const message = err.code === 'INVALID' ? err.message : `Couldn't import: ${err.message}`;
    console.warn(`[catalog] sync of ${source.url} failed: ${err.message}`);
    const saved = await store.updateSource(workspaceId, sourceId, { last_status: 'failed', last_error: message.slice(0, 500), last_synced_at: new Date().toISOString() });
    return { source: saved, error: message };
  }
}

async function addWebsite(workspaceId, url, { dailySync = true } = {}) {
  const clean = importers.normaliseUrl(url);
  const source = await store.upsertSource(workspaceId, clean, { daily_sync: !!dailySync });
  return syncSource(workspaceId, source.id);
}

/** Called by the scheduler every minute: re-sync websites not synced in the last day, one at a time. */
let dailyRunning = false;
async function tickDailySync(now = Date.now()) {
  if (dailyRunning) return 0;
  dailyRunning = true;
  let done = 0;
  try {
    const sources = await store.listDailySources();
    for (const s of sources) {
      if (s.last_status === 'running') continue;
      if (s.last_synced_at && now - new Date(s.last_synced_at).getTime() < DAILY_MS) continue;
      await syncSource(s.workspace_id, s.id);
      done += 1;
    }
  } catch (err) {
    if (err.code !== 'MIGRATION_MISSING') console.warn(`[catalog] daily sync: ${err.message}`);
  } finally {
    dailyRunning = false;
  }
  return done;
}

async function addSynonym(workspaceId, { term, means } = {}) {
  const t = String(term || '').trim().toLowerCase();
  const m = String(means || '').trim();
  const errors = [];
  if (!t) errors.push('Enter the word customers use.');
  if (!m) errors.push('Enter what it means.');
  if (t.length > 60 || m.length > 200) errors.push('That\'s too long.');
  if (errors.length) throw invalid(errors);
  return store.addSynonym(workspaceId, t, m);
}

module.exports = { validate, create, update, remove, importSpreadsheet, addWebsite, syncSource, tickDailySync, addSynonym, STOCK };
