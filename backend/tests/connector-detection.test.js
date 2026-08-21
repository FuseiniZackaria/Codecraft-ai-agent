const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.BROWSER_EXTENSION_TOKEN = 'detect-test-token';
delete require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../core/browserState')];
delete require.cache[require.resolve('../core/connectorDetections')];
delete require.cache[require.resolve('../api/browserRoutes')];
const browserState = require('../core/browserState');
const connectorDetections = require('../core/connectorDetections');
const browserRoutes = require('../api/browserRoutes');

function req(port, { method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { hostname: 'localhost', port, path, method, headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  browserState._reset();
  connectorDetections._reset();

  // A real site that genuinely serves a valid MCP manifest
  const mockSite = http.createServer((r, res) => {
    if (r.url === '/.well-known/mcp.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'Test Tools MCP', version: '1.0.0' }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>normal page</html>');
    }
  });
  await new Promise((resolve) => mockSite.listen(0, resolve));
  const sitePort = mockSite.address().port;
  const siteUrl = `http://localhost:${sitePort}/landing`;

  const app = express();
  app.use(express.json());
  app.use('/api/browser', browserRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  const headers = { 'X-CodeCraft-Token': 'detect-test-token' };

  const t0 = Date.now();
  const visit = await req(port, { method: 'POST', path: '/api/browser/visit', headers, body: { url: siteUrl, title: 'Test Site' } });
  const visitElapsed = Date.now() - t0;
  assert.strictEqual(visit.status, 200);
  assert(visitElapsed < 500, `POST /visit should respond immediately, not wait for the background MCP check (took ${visitElapsed}ms)`);
  console.log('✓ POST /visit responds immediately - the MCP check runs in the background, not blocking the extension');

  const immediatePrompt = await req(port, { path: '/api/browser/prompt', headers });
  assert.strictEqual(immediatePrompt.body.shouldPrompt, false, 'should not prompt while the check is still in flight');
  console.log('✓ /prompt correctly reports no prompt yet while the real check is still running');

  // Give the real background check time to genuinely complete
  await sleep(500);

  const settledPrompt = await req(port, { path: '/api/browser/prompt', headers });
  assert.strictEqual(settledPrompt.body.shouldPrompt, true, 'once the real check completes and finds a manifest, it should prompt');
  assert.strictEqual(settledPrompt.body.detection.manifest.name, 'Test Tools MCP', 'the real manifest content should flow all the way through to the prompt endpoint');
  console.log('✓ once the real background check completes, /prompt reflects the genuine detection with real manifest data');

  const detections = await req(port, { path: '/api/browser/detections', headers });
  assert.strictEqual(detections.body.detections.length, 1);
  console.log('✓ /detections lists the real cached result');

  // Dedup: visiting a second page on the SAME origin should not trigger a second check
  await req(port, { method: 'POST', path: '/api/browser/visit', headers, body: { url: `http://localhost:${sitePort}/other-page`, title: 'Other page' } });
  await sleep(200);
  const afterSecondVisit = await req(port, { path: '/api/browser/detections', headers });
  assert.strictEqual(afterSecondVisit.body.detections.length, 1, 'a second page on the same origin should reuse the cached detection, not trigger a duplicate check');
  console.log('✓ visiting a second page on the same origin correctly reuses the cached detection instead of re-checking');

  mockSite.close();
  server.close();
  console.log('\nAll automatic detection checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
