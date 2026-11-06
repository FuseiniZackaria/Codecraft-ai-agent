// Products (B, C, D): manual add/edit, CSV/Excel upload, website import
// (Shopify, structured data, plain services site), Sync now, daily re-sync,
// spelling-tolerant + Pidgin search, live stock check - over the real routes,
// against a fake shop served on this computer. No real website or AI is used.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';

const assert = require('assert');
const http = require('http');
const express = require('express');
const XLSX = require('xlsx');
const mockProvider = require('../core/providers/mockProvider');
const store = require('../core/catalog/store');
const catalog = require('../core/catalog');
const search = require('../core/catalog/search');

const WS = 'aaaaaaaa-0000-0000-0000-0000000000c7';
const WS_B = 'bbbbbbbb-0000-0000-0000-0000000000c8';

// The "page text" importer asks the AI to list services - answered here.
let aiCalls = 0;
mockProvider.complete = async (req) => {
  aiCalls += 1;
  if (/extract a business catalogue/.test(req.system || '')) {
    if (/nothing-here/.test(req.prompt || '')) return { provider: 'mock', text: JSON.stringify({ items: [] }) };
    return { provider: 'mock', text: JSON.stringify({ items: [
      { name: 'Business Websites', type: 'service', description: 'Professional websites for businesses.', category: 'Websites' },
      { name: 'E-commerce Stores', type: 'service', description: 'Online stores with payments.', category: 'Websites' },
      { name: 'SEO Optimization', type: 'service', description: 'Rank higher on Google.' },
    ] }) };
  }
  return { provider: 'mock', text: '{}' };
};

// ---- fake websites ----
let shopifyAvailable = true;
let shopifyOn = true; // the fake site acts as a Shopify store until switched off
let shopifyItems = [
  { id: 11, title: 'Slim Black Trouser', handle: 'slim-black-trouser', body_html: '<p>Office trouser</p>', product_type: 'Trousers', tags: 'pants, slacks',
    variants: [{ price: '250.00', available: true }], images: [{ src: 'https://cdn.example.com/trouser.jpg' }] },
  { id: 12, title: 'Pink Shirt', handle: 'pink-shirt', body_html: '', product_type: 'Shirts', tags: '',
    variants: [{ price: '150.00', available: false }], images: [] },
];
const site = http.createServer((req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
  if (req.url.startsWith('/shop/products.json')) return send(404, 'text/plain', 'no');
  if (req.url.startsWith('/products.json') && shopifyOn) return send(200, 'application/json', JSON.stringify({ products: shopifyItems }));
  if (req.url === '/products/slim-black-trouser.js') return send(200, 'application/json', JSON.stringify({ available: shopifyAvailable, price: 25000, variants: [{ available: shopifyAvailable }] }));
  if (req.url.startsWith('/ld')) {
    return send(200, 'text/html', `<html><body><h1>Shop</h1>${'<p>filler text for length</p>'.repeat(40)}<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: [
        { '@type': 'ListItem', item: { '@type': 'Product', name: 'Kente Cloth', image: 'https://cdn.example.com/kente.jpg', url: '/kente',
          offers: { '@type': 'Offer', price: '500', priceCurrency: 'GHS', availability: 'https://schema.org/InStock' } } },
        { '@type': 'ListItem', item: { '@type': 'Product', name: 'Chalewote Slippers', offers: { price: '40', availability: 'https://schema.org/OutOfStock' } } },
      ] })}</script></body></html>`);
  }
  if (req.url.startsWith('/services')) return send(200, 'text/html', `<html><body><h1>CodeCraft</h1><p>${'We build business websites, e-commerce stores and do SEO. '.repeat(20)}</p></body></html>`);
  return send(404, 'text/plain', 'not found');
});

// ---- the real routes behind a fake login ----
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => { req.user = { id: 'u1', role: 'admin', workspaceId: req.get('x-ws') || WS, workspaceRole: 'owner' }; next(); });
app.use('/api/products', require('../api/productRoutes'));
let api;
async function call(method, path, body, ws = WS) {
  const res = await fetch(`${api}${path}`, { method, headers: { 'content-type': 'application/json', 'x-ws': ws }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

(async () => {
  const siteUrl = await listen(site);
  const apiServer = http.createServer(app);
  api = await listen(apiServer);

  // B1. Manual add / edit / validation / delete.
  {
    let r = await call('POST', '/api/products', { name: 'Jollof Rice', price: '45', stock_qty: '12', aliases: 'jollof,  party rice ', category: 'Food' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.product.stock_status, 'in_stock', 'a quantity sets "in stock"');
    assert.strictEqual(r.body.product.aliases, 'jollof, party rice');
    const id = r.body.product.id;
    r = await call('PATCH', `/api/products/${id}`, { stock_qty: 0 });
    assert.strictEqual(r.body.product.stock_status, 'out_of_stock');
    r = await call('POST', '/api/products', { name: '', price: 'abc', image_url: 'not a link', stock_status: 'maybe' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.details.length, 4, r.body.details.join(' | '));
    r = await call('PATCH', `/api/products/${id}`, { price: 50 }, WS_B);
    assert.strictEqual(r.status, 404, "another business can't edit it");
    console.log('✓ B: add, edit, check what you type; other businesses can\'t touch your products');
  }

  // B2. CSV upload (columns matched automatically; re-upload updates, no duplicates).
  {
    const csv = 'Product,Price,Qty,Image,Other names\nWaakye Special,35,5,https://cdn.example.com/waakye.jpg,"waakye, waache"\nKelewele,20,0,,\n,10,1,,\nKelewele,20,0,,\n';
    let r = await call('POST', '/api/products/import-csv', { filename: 'menu.csv', data: Buffer.from(csv).toString('base64') });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.added, r.body.updated, r.body.skipped], [2, 0, 2], 'blank and repeated rows skipped');
    const csv2 = 'name,price,stock\nWaakye Special,38,yes\n';
    r = await call('POST', '/api/products/import-csv', { filename: 'menu.csv', data: Buffer.from(csv2).toString('base64') });
    assert.deepStrictEqual([r.body.added, r.body.updated], [0, 1]);
    const all = await store.listProducts(WS);
    const waakye = all.find((p) => p.name === 'Waakye Special');
    assert.strictEqual(Number(waakye.price), 38);
    assert.strictEqual(waakye.aliases, 'waakye, waache', 'other names typed earlier are kept');
    assert(all.find((p) => p.name === 'Kelewele').active, 'a partial CSV does not switch off missing products');
    // Excel works too
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item', 'Price'], ['Sobolo', '10']]), 'S');
    r = await call('POST', '/api/products/import-csv', { filename: 'drinks.xlsx', data: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64') });
    assert.strictEqual(r.body.added, 1);
    r = await call('POST', '/api/products/import-csv', { filename: 'x.csv', data: Buffer.from('colour,size\nred,M\n').toString('base64') });
    assert.strictEqual(r.status, 400);
    assert(/No "name" column/.test(r.body.details[0]));
    console.log('✓ B: CSV and Excel upload - columns matched, stock read, re-upload updates instead of duplicating');
  }

  // B3. Website import: Shopify, structured data, plain services site; Sync now; daily re-sync.
  {
    let r = await call('POST', '/api/products/sources', { url: siteUrl, daily_sync: true });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.method, 'shopify');
    assert.strictEqual(r.body.added, 2);
    let trouser = (await store.listProducts(WS)).find((p) => p.name === 'Slim Black Trouser');
    assert.strictEqual(Number(trouser.price), 250);
    assert.strictEqual(trouser.stock_status, 'in_stock');
    assert.strictEqual(trouser.image_url, 'https://cdn.example.com/trouser.jpg');
    assert.strictEqual(trouser.product_url, `${siteUrl}/products/slim-black-trouser`);
    assert.strictEqual((await store.listProducts(WS)).find((p) => p.name === 'Pink Shirt').stock_status, 'out_of_stock');

    // The shop removes the shirt: Sync now switches it off and keeps the trouser.
    shopifyItems = shopifyItems.filter((p) => p.id !== 12);
    const sourceId = r.body.source.id;
    r = await call('POST', `/api/products/sources/${sourceId}/sync`);
    assert.deepStrictEqual([r.body.updated, r.body.removed], [1, 1]);
    assert.strictEqual((await store.listProducts(WS)).find((p) => p.name === 'Pink Shirt').active, false);

    shopifyOn = false; // the next two sites aren't Shopify stores
    r = await call('POST', '/api/products/sources', { url: `${siteUrl}/ld` });
    assert.strictEqual(r.body.method, 'structured-data');
    const kente = (await store.listProducts(WS)).find((p) => p.name === 'Kente Cloth');
    assert.strictEqual(kente.stock_status, 'in_stock');
    assert.strictEqual(kente.product_url, `${siteUrl}/kente`);

    const before = aiCalls;
    r = await call('POST', '/api/products/sources', { url: `${siteUrl}/services` }, WS_B);
    assert.strictEqual(r.body.method, 'page-text', JSON.stringify(r.body));
    assert.strictEqual(aiCalls, before + 1, 'one AI call to read a normal website');
    const services = await store.listProducts(WS_B);
    assert.deepStrictEqual(services.map((p) => p.name).sort(), ['Business Websites', 'E-commerce Stores', 'SEO Optimization']);
    assert(services.every((p) => p.stock_status === 'always_available'), 'services have no stock');

    r = await call('POST', '/api/products/sources', { url: 'http://localhost' });
    assert.strictEqual(r.status, 200);
    r = await call('POST', '/api/products/sources', { url: `${siteUrl}/nothing-here` });
    assert(r.body.error && r.body.source.last_status === 'failed', 'a failed import is recorded with a reason');

    // Daily re-sync: only websites not synced in the last day.
    const sources = await store.listSources(WS);
    await store.updateSource(WS, sources[0].id, { last_synced_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
    shopifyOn = true; // the first site is a Shopify store again for its daily re-sync
    const synced = await catalog.tickDailySync();
    assert(synced >= 1, `daily sync ran ${synced}`);
    console.log('✓ B: website import (Shopify, structured data, normal services site), Sync now, removed items switched off, daily re-sync');
  }

  // C. Search: misspellings, Pidgin, local words - with a catalogue big enough to need searching.
  {
    for (let i = 0; i < 40; i++) await store.createProduct(WS, { name: `Plain Notebook ${i}`, category: 'Stationery', stock_status: 'in_stock' });
    await store.createProduct(WS, { name: 'Leather Slippers', aliases: 'sandals', stock_status: 'in_stock' });
    const find = async (text) => (await search.forMessage(WS, { message: text })).products.map((p) => p.name);
    assert.strictEqual((await find('do you have jolof rice?'))[0], 'Jollof Rice', 'misspelt "jolof"');
    assert.strictEqual((await find('abeg you get trowser?'))[0], 'Slim Black Trouser', 'Pidgin + misspelt "trowser"');
    const slippers = await find('chale I wan buy chalewote');
    assert(slippers.includes('Leather Slippers'), `built-in local word chalewote -> slippers finds a product that never says "chalewote": ${slippers}`);
    let r = await call('POST', '/api/products/synonyms', { term: 'ahwenepa', means: 'kente cloth' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual((await find('you get ahwenepa?'))[0], 'Kente Cloth', 'the business\'s own local word');
    assert.deepStrictEqual(await find('hello good morning'), [], 'small talk finds nothing');
    r = await call('GET', `/api/products/search?q=${encodeURIComponent('abeg how much be the jolof')}`);
    assert(r.body.terms.includes('jolof') && !r.body.terms.includes('abeg'), JSON.stringify(r.body.terms));
    console.log('✓ C: finds products from misspellings ("jolof", "trowser"), Pidgin, built-in and your own local words');
  }

  // D. Live stock: a website item is re-checked before the agent talks about it (and cached).
  {
    let trouser = (await store.listProducts(WS)).find((p) => p.name === 'Slim Black Trouser');
    await store.updateProduct(WS, trouser.id, { stock_checked_at: null });
    shopifyAvailable = false;
    let found = await search.forMessage(WS, { message: 'slim black trouser' });
    let p = found.products.find((x) => x.name === 'Slim Black Trouser');
    assert.strictEqual(p.stock_status, 'out_of_stock', 'sold out on the website -> out of stock now');
    assert(found.block.includes('Slim Black Trouser') && found.block.includes('OUT OF STOCK'));
    shopifyAvailable = true;
    found = await search.forMessage(WS, { message: 'slim black trouser' });
    p = found.products.find((x) => x.name === 'Slim Black Trouser');
    assert.strictEqual(p.stock_status, 'out_of_stock', 'checked a moment ago -> cached (no new check for 10 minutes)');
    const csvItem = (await store.listProducts(WS)).find((x) => x.name === 'Kelewele');
    assert.strictEqual(csvItem.stock_checked_at, undefined, 'CSV items are never fetched');
    const unknown = await store.createProduct(WS, { name: 'Mystery Box', stock_status: 'unknown' });
    assert(search.stockLine(unknown).includes("don't say it's available"));
    console.log('✓ D: live stock check for website products (cached 10 min); CSV/manual use saved stock; unknown is never promised');
  }

  // Small catalogue: everything is shown (nothing can be missed).
  {
    const found = await search.forMessage(WS_B, { message: 'hi' });
    assert.strictEqual(found.products.length, 3);
    assert(found.block.includes('[P1]') && found.block.includes('available (a service'));
    console.log('✓ a small catalogue is given to the agent in full, labelled [P1]...');
  }

  apiServer.close();
  site.close();
  console.log('All catalog checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
