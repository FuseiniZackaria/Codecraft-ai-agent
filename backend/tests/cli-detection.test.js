const assert = require('assert');
const http = require('http');
const express = require('express');
const { scanForCLIMentions } = require('../core/cliDetection');

process.env.BROWSER_EXTENSION_TOKEN = 'cli-test-token';
delete require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../core/browserState')];
delete require.cache[require.resolve('../core/connectorDetections')];
delete require.cache[require.resolve('../core/cliDetections')];
delete require.cache[require.resolve('../api/browserRoutes')];
const browserState = require('../core/browserState');
const connectorDetections = require('../core/connectorDetections');
const cliDetections = require('../core/cliDetections');
const browserRoutes = require('../api/browserRoutes');

function serve(html, contentType = 'text/html') {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(html);
  });
}

function httpReq(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: 'localhost', port, path, method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  // --- Module-level: real positive case matching this project's own origin story ---
  const realPageHTML = `<html><body><code>npx mdskills install nextlevelbuilder/ui-ux-pro-max</code></body></html>`;
  const server1 = serve(realPageHTML);
  await new Promise((r) => server1.listen(0, r));
  const port1 = server1.address().port;
  const result1 = await scanForCLIMentions(`http://localhost:${port1}`);
  assert.strictEqual(result1.found, true);
  assert(
    result1.matches.some((m) => m.command === 'npx mdskills install nextlevelbuilder/ui-ux-pro-max'),
    'the FULL real command should be extracted, including everything after the slash - not truncated at "nextlevelbuilder"'
  );
  server1.close();
  console.log('✓ a real npx install command on a page is genuinely found and extracted');

  // --- REGRESSION: the exact truncation bug that was reported - a slash
  // appearing after the FIRST word was being cut off, because only the
  // first word's character class allowed it. Prove it's fixed for a
  // DIFFERENT pattern too (brew taps have the same shape), not just npx. ---
  const tapPageHTML = `<html><body><code>brew install nextlevelbuilder/tap/formula</code></body></html>`;
  const tapServer = serve(tapPageHTML);
  await new Promise((r) => tapServer.listen(0, r));
  const tapPort = tapServer.address().port;
  const tapResult = await scanForCLIMentions(`http://localhost:${tapPort}`);
  assert(
    tapResult.matches.some((m) => m.command === 'brew install nextlevelbuilder/tap/formula'),
    'a brew tap-style package name (with slashes) must not be truncated either - the fix must be uniform across every pattern, not npx-specific'
  );
  tapServer.close();
  console.log('✓ REGRESSION: slashes after the first word are no longer truncated, verified on a second, different pattern');

  // --- Negative case ---
  const server2 = serve('<html><body><p>Just an ordinary blog post about recipes.</p></body></html>');
  await new Promise((r) => server2.listen(0, r));
  const port2 = server2.address().port;
  const result2 = await scanForCLIMentions(`http://localhost:${port2}`);
  assert.strictEqual(result2.found, false);
  server2.close();
  console.log('✓ an ordinary page with no CLI mentions correctly reports nothing found');

  // --- Script/style content correctly excluded ---
  const server3 = serve('<html><head><script>console.log("npx fake-thing run")</script></head><body><p>hi</p></body></html>');
  await new Promise((r) => server3.listen(0, r));
  const port3 = server3.address().port;
  const result3 = await scanForCLIMentions(`http://localhost:${port3}`);
  assert.strictEqual(result3.found, false, 'text inside <script> tags should not count as a real page mention');
  server3.close();
  console.log('✓ script tag content is correctly excluded from scanning');

  // --- Route layer: /visit triggers both MCP and CLI background checks independently ---
  browserState._reset();
  connectorDetections._reset();
  cliDetections._reset();

  const cliSiteServer = serve('<html><body><code>pip install real-package-here</code></body></html>');
  await new Promise((r) => cliSiteServer.listen(0, r));
  const cliSitePort = cliSiteServer.address().port;
  const cliSiteUrl = `http://localhost:${cliSitePort}/page`;

  const app = express();
  app.use(express.json());
  app.use('/api/browser', browserRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  const headers = { 'X-CodeCraft-Token': 'cli-test-token' };

  await httpReq(port, '/api/browser/visit', { method: 'POST', headers, body: { url: cliSiteUrl, title: 'CLI test site' } });
  await sleep(500); // let both real background checks genuinely complete

  const promptRes = await httpReq(port, '/api/browser/prompt', { headers });
  assert.strictEqual(promptRes.body.cliMentionFound, true, 'the real CLI mention should flow through the prompt endpoint');
  assert(promptRes.body.cliDetection.matches.some((m) => m.command.includes('pip install real-package-here')));
  assert.strictEqual(promptRes.body.shouldPrompt, false, 'a CLI-only mention must never be reported as shouldPrompt - that field is reserved for verified MCP matches');
  console.log('✓ visiting a page automatically triggers a real CLI scan, reported separately from the verified MCP field');

  cliSiteServer.close();
  server.close();

  // --- THE REAL BUG, reproduced directly: two different pages on the SAME
  // origin, each with different text. Visiting the second page must scan
  // the second page's own content, not silently reuse the first page's
  // cached result just because they share a site. ---
  browserState._reset();
  connectorDetections._reset();
  cliDetections._reset();

  const multiPageServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url === '/homepage') {
      res.end('<html><body><p>Featured: pip install quant-garage and try it out</p></body></html>');
    } else if (req.url === '/specific-skill') {
      res.end('<html><body><code>npx mdskills install nextlevelbuilder/ui-ux-pro-max</code></body></html>');
    } else {
      res.end('<html><body>other</body></html>');
    }
  });
  await new Promise((r) => multiPageServer.listen(0, r));
  const mpPort = multiPageServer.address().port;
  const homepageUrl = `http://localhost:${mpPort}/homepage`;
  const skillPageUrl = `http://localhost:${mpPort}/specific-skill`;

  const app3 = express();
  app3.use(express.json());
  app3.use('/api/browser', browserRoutes);
  const server3b = await new Promise((resolve) => { const s = app3.listen(0, () => resolve(s)); });
  const port3b = server3b.address().port;
  const headers2 = { 'X-CodeCraft-Token': 'cli-test-token' };

  // Visit the homepage first - it gets cached with its own real content
  await httpReq(port3b, '/api/browser/visit', { method: 'POST', headers: headers2, body: { url: homepageUrl, title: 'Homepage' } });
  await sleep(400);
  const afterHomepage = await httpReq(port3b, '/api/browser/prompt', { headers: headers2 });
  assert(afterHomepage.body.cliDetection.matches.some((m) => m.command.includes('pip install quant-garage')));

  // Now visit a DIFFERENT page on the same origin
  await httpReq(port3b, '/api/browser/visit', { method: 'POST', headers: headers2, body: { url: skillPageUrl, title: 'Skill page' } });
  await sleep(400);
  const afterSkillPage = await httpReq(port3b, '/api/browser/prompt', { headers: headers2 });

  assert(
    afterSkillPage.body.cliDetection.matches.some((m) => m.command === 'npx mdskills install nextlevelbuilder/ui-ux-pro-max'),
    'the second page must be scanned for its OWN content, not reuse the homepage\'s cached result'
  );
  assert(
    !afterSkillPage.body.cliDetection.matches.some((m) => m.command.includes('quant-garage')),
    'the second page\'s result must not contain the FIRST page\'s stale match - this is the exact bug that was reported'
  );
  console.log('✓ REGRESSION: visiting a second page on the same site correctly shows that page\'s own content, not a stale result from an earlier page');

  multiPageServer.close();
  server3b.close();

  console.log('\nAll CLI detection checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
