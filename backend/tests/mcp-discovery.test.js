const assert = require('assert');
const http = require('http');
const express = require('express');
const { checkForMCP } = require('../core/mcpDiscovery');

process.env.BROWSER_EXTENSION_TOKEN = 'mcp-test-token';
delete require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../core/browserState')];
delete require.cache[require.resolve('../api/browserRoutes')];
const browserState = require('../core/browserState');
const browserRoutes = require('../api/browserRoutes');

function httpRequest(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path, method: 'GET', headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  // --- Real positive case: a real local server genuinely serving a valid manifest ---
  const mcpManifest = { name: 'Test MCP Server', version: '1.0.0' };
  const mcpServer = http.createServer((req, res) => {
    if (req.url === '/.well-known/mcp.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mcpManifest));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => mcpServer.listen(0, resolve));
  const mcpPort = mcpServer.address().port;

  const found = await checkForMCP(`http://localhost:${mcpPort}/some/page`);
  assert.strictEqual(found.found, true);
  assert.strictEqual(found.matchedPath, '/.well-known/mcp.json');
  assert.deepStrictEqual(found.manifest, mcpManifest, 'the real manifest content should be genuinely parsed and returned');
  assert.strictEqual(found.checkedPaths.length, 1, 'should stop checking further candidate paths once one succeeds');
  mcpServer.close();
  console.log('✓ a real MCP manifest at a real endpoint is genuinely found and parsed');

  // --- No candidate paths present (the common case) ---
  const plainServer = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise((resolve) => plainServer.listen(0, resolve));
  const plainPort = plainServer.address().port;
  const notFound = await checkForMCP(`http://localhost:${plainPort}`);
  assert.strictEqual(notFound.found, false);
  assert.strictEqual(notFound.checkedPaths.length, 3, 'should have genuinely tried all 3 candidate paths before giving up');
  plainServer.close();
  console.log('✓ a site with none of the candidate paths correctly reports not found, having tried all conventions');

  // --- False-positive avoidance: a 200 response that is HTML, not a real manifest ---
  const htmlServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>just a normal page</html>');
  });
  await new Promise((resolve) => htmlServer.listen(0, resolve));
  const htmlPort = htmlServer.address().port;
  const htmlResult = await checkForMCP(`http://localhost:${htmlPort}`);
  assert.strictEqual(htmlResult.found, false, 'a 200 HTML response must never be mistaken for a real MCP manifest');
  htmlServer.close();
  console.log('✓ a 200 response that is not real JSON is correctly NOT treated as a match (avoids false positives)');

  // --- Real timeout handling: a server that never responds ---
  const hangServer = http.createServer(() => {});
  await new Promise((resolve) => hangServer.listen(0, resolve));
  const hangPort = hangServer.address().port;
  const start = Date.now();
  const hangResult = await checkForMCP(`http://localhost:${hangPort}`, { timeoutMs: 200 });
  const elapsed = Date.now() - start;
  assert.strictEqual(hangResult.found, false);
  assert(elapsed < 3000, 'should respect the configured timeout instead of hanging indefinitely');
  hangServer.close();
  console.log('✓ a server that never responds is handled via real timeout, not an indefinite hang');

  // --- Invalid input ---
  const invalid = await checkForMCP('not a url');
  assert.strictEqual(invalid.found, false);
  assert(invalid.error);
  console.log('✓ invalid URL input is rejected cleanly rather than throwing');

  // --- Route layer: GET /api/browser/check-mcp with explicit ?url= ---
  browserState._reset();
  const app = express();
  app.use(express.json());
  app.use('/api/browser', browserRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;

  const noToken = await httpRequest(port, '/api/browser/check-mcp?url=https://example.com');
  assert.strictEqual(noToken.status, 401, 'the check-mcp route must be protected by the same token as the rest of /api/browser');

  const noUrl = await httpRequest(port, '/api/browser/check-mcp', { 'X-CodeCraft-Token': 'mcp-test-token' });
  assert.strictEqual(noUrl.status, 400, 'with no url param and no recorded current site, should fail clearly rather than guessing');

  const withUrl = await httpRequest(port, '/api/browser/check-mcp?url=https://github.com', { 'X-CodeCraft-Token': 'mcp-test-token' });
  assert.strictEqual(withUrl.status, 200);
  assert.strictEqual(withUrl.body.found, false, 'a real check against github.com over real HTTP should genuinely complete and report not-found');
  console.log('✓ GET /api/browser/check-mcp is token-protected and performs a real check end to end');

  server.close();
  console.log('\nAll MCP discovery checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
