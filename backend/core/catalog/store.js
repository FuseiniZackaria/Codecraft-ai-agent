const crypto = require('crypto');
const config = require('../../config');

/**
 * Storage for the product catalogue (migration 0007_products.sql).
 * Every function is scoped to one workspace (business).
 * Supabase when configured, otherwise in memory (tests, local runs).
 */

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}

const mem = { products: [], sources: [], synonyms: [] };
const now = () => new Date().toISOString();

function check(error, where) {
  if (!error) return;
  if (/does not exist|schema cache|search_products/i.test(error.message)) {
    const err = new Error('The products tables are missing - run backend/database/migrations/0007_products.sql in Supabase (SQL Editor).');
    err.code = 'MIGRATION_MISSING';
    throw err;
  }
  throw new Error(`catalog store (${where}): ${error.message}`);
}
function requireWs(ws) {
  if (!ws) throw new Error('catalog store: a workspaceId is required');
}

const FIELDS = ['name', 'aliases', 'description', 'category', 'price', 'currency', 'stock_status', 'stock_qty', 'image_url',
  'product_url', 'source', 'source_id', 'external_id', 'active', 'stock_checked_at'];
const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => FIELDS.includes(k)));

// ---------- products ----------

async function listProducts(workspaceId, { activeOnly = false, limit = 2000 } = {}) {
  requireWs(workspaceId);
  if (!db()) {
    return mem.products.filter((p) => p.workspace_id === workspaceId && (!activeOnly || p.active))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit).map((p) => ({ ...p }));
  }
  let q = db().from('products').select('*').eq('workspace_id', workspaceId);
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q.order('name').limit(limit);
  check(error, 'listProducts');
  return data || [];
}

async function countProducts(workspaceId, { activeOnly = true } = {}) {
  requireWs(workspaceId);
  if (!db()) return mem.products.filter((p) => p.workspace_id === workspaceId && (!activeOnly || p.active)).length;
  let q = db().from('products').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
  if (activeOnly) q = q.eq('active', true);
  const { count, error } = await q;
  check(error, 'countProducts');
  return count || 0;
}

async function getProduct(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) { const p = mem.products.find((x) => x.workspace_id === workspaceId && x.id === id); return p ? { ...p } : null; }
  const { data, error } = await db().from('products').select('*').eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  check(error, 'getProduct');
  return data;
}

async function createProduct(workspaceId, fields) {
  requireWs(workspaceId);
  const row = { workspace_id: workspaceId, currency: 'GHS', stock_status: 'unknown', aliases: '', source: 'manual', active: true, ...pick(fields) };
  if (!db()) {
    const saved = { id: crypto.randomUUID(), created_at: now(), updated_at: now(), ...row };
    mem.products.push(saved);
    return { ...saved };
  }
  const { data, error } = await db().from('products').insert(row).select('*').single();
  check(error, 'createProduct');
  return data;
}

async function updateProduct(workspaceId, id, fields) {
  requireWs(workspaceId);
  const patch = { ...pick(fields), updated_at: now() };
  if (!db()) {
    const p = mem.products.find((x) => x.workspace_id === workspaceId && x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    return { ...p };
  }
  const { data, error } = await db().from('products').update(patch).eq('workspace_id', workspaceId).eq('id', id).select('*').maybeSingle();
  check(error, 'updateProduct');
  return data;
}

async function deleteProduct(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) {
    const before = mem.products.length;
    mem.products = mem.products.filter((x) => !(x.workspace_id === workspaceId && x.id === id));
    return mem.products.length < before;
  }
  const { data, error } = await db().from('products').delete().eq('workspace_id', workspaceId).eq('id', id).select('id');
  check(error, 'deleteProduct');
  return (data || []).length > 0;
}

/**
 * Insert or update imported items by (source, external_id). Items from this
 * source that are no longer there are switched off (not deleted - you can
 * still see and edit them), unless keepMissing (a partial CSV list). Returns { added, updated, removed }.
 */
async function upsertFromSource(workspaceId, { source, sourceId = null, items, keepMissing = false }) {
  requireWs(workspaceId);
  const existing = (await listProducts(workspaceId)).filter((p) => p.source === source && (sourceId ? p.source_id === sourceId : true));
  const byExt = new Map(existing.filter((p) => p.external_id).map((p) => [p.external_id, p]));
  const seen = new Set();
  let added = 0;
  let updated = 0;
  for (const item of items) {
    const ext = String(item.external_id);
    seen.add(ext);
    const fields = { ...item, source, source_id: sourceId, external_id: ext, active: true };
    const found = byExt.get(ext);
    if (found) {
      // Keep what the owner typed by hand (other names) and only refresh what the source owns.
      if (found.aliases && !item.aliases) delete fields.aliases;
      await updateProduct(workspaceId, found.id, fields);
      updated += 1;
    } else {
      await createProduct(workspaceId, fields);
      added += 1;
    }
  }
  let removed = 0;
  if (keepMissing) return { added, updated, removed };
  for (const p of existing) {
    if (p.external_id && !seen.has(p.external_id) && p.active) {
      await updateProduct(workspaceId, p.id, { active: false });
      removed += 1;
    }
  }
  return { added, updated, removed };
}

/**
 * Spelling-tolerant search (Postgres pg_trgm). In memory: a small JS version
 * of the same idea, so tests behave like production.
 */
async function searchProducts(workspaceId, query, limit = 8) {
  requireWs(workspaceId);
  if (!String(query || '').trim()) return [];
  if (!db()) {
    const { fuzzyScore } = require('./search');
    return mem.products
      .filter((p) => p.workspace_id === workspaceId && p.active)
      .map((p) => ({ p, s: fuzzyScore(p, query) }))
      .filter((x) => x.s >= 0.45)
      .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
      .slice(0, limit)
      .map((x) => ({ ...x.p, score: x.s }));
  }
  const { data, error } = await db().rpc('search_products', { p_workspace: workspaceId, p_query: query, p_limit: limit });
  check(error, 'searchProducts');
  return (data || []).map((r) => ({ ...r.product, score: r.score }));
}

// ---------- website sources ----------

async function listSources(workspaceId) {
  requireWs(workspaceId);
  if (!db()) return mem.sources.filter((s) => s.workspace_id === workspaceId).map((s) => ({ ...s }));
  const { data, error } = await db().from('product_sources').select('*').eq('workspace_id', workspaceId).order('created_at');
  check(error, 'listSources');
  return data || [];
}

/** Every workspace's sources that want a daily re-sync (for the scheduler). */
async function listDailySources() {
  if (!db()) return mem.sources.filter((s) => s.daily_sync).map((s) => ({ ...s }));
  const { data, error } = await db().from('product_sources').select('*').eq('daily_sync', true);
  check(error, 'listDailySources');
  return data || [];
}

async function getSource(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) { const s = mem.sources.find((x) => x.workspace_id === workspaceId && x.id === id); return s ? { ...s } : null; }
  const { data, error } = await db().from('product_sources').select('*').eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  check(error, 'getSource');
  return data;
}

async function upsertSource(workspaceId, url, fields = {}) {
  requireWs(workspaceId);
  if (!db()) {
    let s = mem.sources.find((x) => x.workspace_id === workspaceId && x.url === url);
    if (!s) { s = { id: crypto.randomUUID(), workspace_id: workspaceId, url, kind: 'website', daily_sync: true, item_count: 0, created_at: now() }; mem.sources.push(s); }
    Object.assign(s, fields);
    return { ...s };
  }
  const { data, error } = await db().from('product_sources')
    .upsert({ workspace_id: workspaceId, url, ...fields }, { onConflict: 'workspace_id,url' }).select('*').single();
  check(error, 'upsertSource');
  return data;
}

async function updateSource(workspaceId, id, fields) {
  requireWs(workspaceId);
  if (!db()) {
    const s = mem.sources.find((x) => x.workspace_id === workspaceId && x.id === id);
    if (!s) return null;
    Object.assign(s, fields);
    return { ...s };
  }
  const { data, error } = await db().from('product_sources').update(fields).eq('workspace_id', workspaceId).eq('id', id).select('*').maybeSingle();
  check(error, 'updateSource');
  return data;
}

async function deleteSource(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) {
    const before = mem.sources.length;
    mem.sources = mem.sources.filter((x) => !(x.workspace_id === workspaceId && x.id === id));
    return mem.sources.length < before;
  }
  const { data, error } = await db().from('product_sources').delete().eq('workspace_id', workspaceId).eq('id', id).select('id');
  check(error, 'deleteSource');
  return (data || []).length > 0;
}

// ---------- local words ----------

async function listSynonyms(workspaceId) {
  requireWs(workspaceId);
  if (!db()) return mem.synonyms.filter((s) => s.workspace_id === workspaceId).map((s) => ({ ...s }));
  const { data, error } = await db().from('product_synonyms').select('id, term, means').eq('workspace_id', workspaceId).order('term');
  check(error, 'listSynonyms');
  return data || [];
}

async function addSynonym(workspaceId, term, means) {
  requireWs(workspaceId);
  if (!db()) {
    mem.synonyms = mem.synonyms.filter((s) => !(s.workspace_id === workspaceId && s.term === term));
    const row = { id: crypto.randomUUID(), workspace_id: workspaceId, term, means };
    mem.synonyms.push(row);
    return { ...row };
  }
  const { data, error } = await db().from('product_synonyms')
    .upsert({ workspace_id: workspaceId, term, means }, { onConflict: 'workspace_id,term' }).select('id, term, means').single();
  check(error, 'addSynonym');
  return data;
}

async function deleteSynonym(workspaceId, id) {
  requireWs(workspaceId);
  if (!db()) {
    const before = mem.synonyms.length;
    mem.synonyms = mem.synonyms.filter((x) => !(x.workspace_id === workspaceId && x.id === id));
    return mem.synonyms.length < before;
  }
  const { data, error } = await db().from('product_synonyms').delete().eq('workspace_id', workspaceId).eq('id', id).select('id');
  check(error, 'deleteSynonym');
  return (data || []).length > 0;
}

function _resetMemory() {
  mem.products = [];
  mem.sources = [];
  mem.synonyms = [];
}

module.exports = {
  listProducts, countProducts, getProduct, createProduct, updateProduct, deleteProduct, upsertFromSource, searchProducts,
  listSources, listDailySources, getSource, upsertSource, updateSource, deleteSource,
  listSynonyms, addSynonym, deleteSynonym, _resetMemory,
};
