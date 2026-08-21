const assert = require('assert');
const http = require('http');
const fs = require('fs');
const { loadPlugins } = require('../core/pluginLoader');
loadPlugins();
const cliImport = require('../core/cliImport');
const { SkillManager } = require('../core/installer/SkillManager');
const guidanceRegistry = require('../core/guidanceRegistry');
const mockProvider = require('../core/providers/mockProvider');
const BaseAgent = require('../agents/base/BaseAgent');

const realPageHTML = `<!DOCTYPE html><html><head><title>Real Test Tool - Docs</title></head><body>
  <h1>Real Test Tool</h1>
  <p>A tool for doing genuinely useful things from the command line.</p>
  <code>npx realtesttool install some/real-package</code>
  <p>Full documentation on how this actually works, with real explanatory text a developer would read.</p>
  <script>console.log("this script content should never end up in the guidance text");</script>
</body></html>`;

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

async function run() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(realPageHTML);
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const url = `http://localhost:${port}/docs`;

  const { manifest, guidanceContent } = await cliImport.buildSkillFromPage(url, 'npx realtesttool install some/real-package');
  assert.strictEqual(manifest.name, 'Real Test Tool - Docs', 'the real page title should be genuinely extracted, not a placeholder');
  assert.strictEqual(manifest.kind, 'guidance', 'imported skills must ALWAYS be guidance-kind - never tool-kind, since that would mean an executable entry point');
  assert.strictEqual(manifest.entry, undefined, 'a guidance-kind manifest must have no entry field at all');
  assert(guidanceContent.includes('genuinely useful things from the command line'), 'the real page content should be present, not a stub');
  assert(!guidanceContent.includes('this script content should never'), 'script tag content must be excluded from the imported guidance');
  console.log('✓ a real skill is built from a real page, always as guidance-kind, with script content correctly excluded');

  const mgr = new SkillManager();
  const packageDir = cliImport.writePackageToTempDir(manifest, guidanceContent);

  // The critical safety property this whole feature depends on: there is
  // no executable code anywhere in the generated package.
  const filesInPackage = fs.readdirSync(packageDir).sort();
  assert.deepStrictEqual(filesInPackage, ['guidance.md', 'manifest.json'], 'the generated package must contain ONLY the manifest and guidance text - nothing executable');
  console.log('✓ SAFETY: the generated package contains no executable code whatsoever, only text');

  const result = await mgr.installer.install(packageDir, { approvedPermissions: [] });
  assert.strictEqual(result.skill.id, manifest.id);
  assert(guidanceRegistry.list().some((g) => g.id === manifest.id));
  console.log('✓ installs through the real, existing installer pipeline - not a shortcut around it');

  let capturedSystem = null;
  mockProvider.complete = async ({ system }) => { capturedSystem = system; return { text: 'ok', provider: 'mock', costEstimate: 0 }; };
  const agent = new BaseAgent({ key: 'test-agent', role: 'Tester', tools: [] });
  await agent.execute({ type: 'llm_call', instruction: 'do something with realtesttool' }, { id: 't1', instruction: 'n/a' });
  assert(capturedSystem.includes('genuinely useful things from the command line'), 'the imported content should genuinely reach an agent prompt');
  console.log('✓ the imported real content genuinely reaches an agent prompt');

  // --- Route layer ---
  await mgr.remove(manifest.id);
  process.env.BROWSER_EXTENSION_TOKEN = 'cli-import-test-token';
  delete require.cache[require.resolve('../config')];
  delete require.cache[require.resolve('../api/browserRoutes')];
  const express = require('express');
  const browserRoutes = require('../api/browserRoutes');
  const app = express();
  app.use(express.json());
  app.use('/api/browser', browserRoutes);
  const routeServer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const routePort = routeServer.address().port;
  const headers = { 'X-CodeCraft-Token': 'cli-import-test-token' };

  const importRes = await httpReq(routePort, '/api/browser/cli/import', { method: 'POST', headers, body: { url, command: 'npx realtesttool install some/real-package' } });
  assert.strictEqual(importRes.status, 200);
  assert.strictEqual(importRes.body.ok, true);
  assert(guidanceRegistry.list().some((g) => g.id === importRes.body.skillId));
  console.log('✓ the real API route performs a genuine import end to end');

  await mgr.remove(importRes.body.skillId);
  routeServer.close();
  server.close();

  console.log('\nAll CLI-import checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
