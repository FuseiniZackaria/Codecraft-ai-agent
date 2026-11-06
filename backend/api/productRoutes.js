const express = require('express');
const store = require('../core/catalog/store');
const catalog = require('../core/catalog');
const search = require('../core/catalog/search');
const { requireKnowledgeEditor } = require('../core/workspaceAccess');

/**
 * /api/products - the caller's workspace catalogue (Settings -> General -> Products).
 *
 *   GET    /                      products, websites, local words
 *   POST   /                      add a product
 *   PATCH  /:id                   edit (incl. on/off)
 *   DELETE /:id                   delete
 *   POST   /import-csv            { filename, data (base64) } - CSV or Excel
 *   POST   /sources               { url, daily_sync } - add a website and import it now
 *   POST   /sources/:id/sync      "Sync now"
 *   PATCH  /sources/:id           { daily_sync }
 *   DELETE /sources/:id           stop importing from it (its products stay, switched off)
 *   POST   /synonyms              { term, means } - a local word
 *   DELETE /synonyms/:id
 *   GET    /search?q=             try the search the agent uses
 */

const router = express.Router();
router.use(requireKnowledgeEditor);

function fail(res, err) {
  if (err.code === 'INVALID') return res.status(400).json({ error: err.details ? 'Please fix this and try again.' : err.message, details: err.details || [err.message] });
  if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
  if (err.code === 'MIGRATION_MISSING') return res.status(503).json({ error: err.message, migrationMissing: true });
  console.warn(`[products] ${err.message}`);
  return res.status(500).json({ error: err.message });
}
const ws = (req) => req.user.workspaceId;
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { fail(res, err); } };

router.get('/', wrap(async (req, res) => {
  const [products, sources, synonyms] = await Promise.all([store.listProducts(ws(req)), store.listSources(ws(req)), store.listSynonyms(ws(req))]);
  res.json({ products, sources, synonyms, builtInWords: Object.keys(search.BUILT_IN_WORDS).length, includeAllLimit: search.INCLUDE_ALL });
}));

router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 300);
  const synonyms = await store.listSynonyms(ws(req)).catch(() => []);
  const terms = search.keyTerms(q, synonyms);
  const results = terms.length ? await store.searchProducts(ws(req), terms.join(' '), search.MAX_MATCHES) : [];
  res.json({ terms, results });
}));

router.post('/', wrap(async (req, res) => res.status(201).json({ product: await catalog.create(ws(req), req.body || {}) })));
router.patch('/:id', wrap(async (req, res) => res.json({ product: await catalog.update(ws(req), req.params.id, req.body || {}) })));
router.delete('/:id', wrap(async (req, res) => { await catalog.remove(ws(req), req.params.id); res.json({ deleted: true }); }));

router.post('/import-csv', wrap(async (req, res) => res.json(await catalog.importSpreadsheet(ws(req), req.body || {}))));

router.post('/sources', wrap(async (req, res) => {
  const result = await catalog.addWebsite(ws(req), req.body?.url, { dailySync: req.body?.daily_sync !== false });
  res.status(result.error ? 200 : 201).json(result);
}));
router.post('/sources/:id/sync', wrap(async (req, res) => res.json(await catalog.syncSource(ws(req), req.params.id))));
router.patch('/sources/:id', wrap(async (req, res) => {
  const saved = await store.updateSource(ws(req), req.params.id, { daily_sync: !!req.body?.daily_sync });
  if (!saved) return res.status(404).json({ error: 'That website was not found.' });
  res.json({ source: saved });
}));
router.delete('/sources/:id', wrap(async (req, res) => {
  const products = (await store.listProducts(ws(req))).filter((p) => p.source_id === req.params.id && p.active);
  if (!(await store.deleteSource(ws(req), req.params.id))) return res.status(404).json({ error: 'That website was not found.' });
  for (const p of products) await store.updateProduct(ws(req), p.id, { active: false });
  res.json({ deleted: true, switchedOff: products.length });
}));

router.post('/synonyms', wrap(async (req, res) => res.status(201).json({ synonym: await catalog.addSynonym(ws(req), req.body || {}) })));
router.delete('/synonyms/:id', wrap(async (req, res) => {
  if (!(await store.deleteSynonym(ws(req), req.params.id))) return res.status(404).json({ error: 'That word was not found.' });
  res.json({ deleted: true });
}));

module.exports = router;
