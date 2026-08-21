const assert = require('assert');
const http = require('http');
const express = require('express');

// Reload config with a real token BEFORE requiring the route (config reads
// env once at require-time), then reload the route fresh so it picks up
// the same config instance.
process.env.BROWSER_EXTENSION_TOKEN = 'test-token-xyz';
delete require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../core/browserState')];
delete require.cache[require.resolve('../api/browserRoutes')];
const config = require('../config');
const browserState = require('../core/browserState');
const browserRoutes = require('../api/browserRoutes');

function request(port, { method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { hostname: 'localhost', port, path, method, headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch { /* leave null */ }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  assert.strictEqual(config.browserExtension.token, 'test-token-xyz', 'config should have picked up the real env token');

  browserState._reset();
  const app = express();
  app.use(express.json());
  app.use('/api/browser', browserRoutes);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  try {
    const noToken = await request(port, { method: 'POST', path: '/api/browser/visit', body: { url: 'https://example.com' } });
    assert.strictEqual(noToken.status, 401, 'a request with no token should be rejected');

    const wrongToken = await request(port, {
      method: 'POST', path: '/api/browser/visit', headers: { 'X-CodeCraft-Token': 'nope' }, body: { url: 'https://example.com' },
    });
    assert.strictEqual(wrongToken.status, 401, 'a request with the wrong token should be rejected');
    console.log('✓ requests with no token or the wrong token are rejected with 401');

    const missingUrl = await request(port, {
      method: 'POST', path: '/api/browser/visit', headers: { 'X-CodeCraft-Token': 'test-token-xyz' }, body: {},
    });
    assert.strictEqual(missingUrl.status, 400, 'a request missing url should be rejected');
    console.log('✓ a request missing the url field is rejected with 400');

    const visit1 = await request(port, {
      method: 'POST', path: '/api/browser/visit', headers: { 'X-CodeCraft-Token': 'test-token-xyz' },
      body: { url: 'https://mdskills.ai/skills/ui-ux-pro-max', title: 'UI UX Pro Max' },
    });
    assert.strictEqual(visit1.status, 200);
    assert.strictEqual(visit1.body.recorded.url, 'https://mdskills.ai/skills/ui-ux-pro-max');
    assert(visit1.body.recorded.visitedAt, 'a real timestamp should be recorded');
    console.log('✓ a correctly authenticated real visit is recorded with a real timestamp');

    const current = await request(port, { method: 'GET', path: '/api/browser/current', headers: { 'X-CodeCraft-Token': 'test-token-xyz' } });
    assert.strictEqual(current.status, 200);
    assert.strictEqual(current.body.current.url, 'https://mdskills.ai/skills/ui-ux-pro-max');
    console.log('✓ the recorded visit is genuinely readable back via GET /current');

    await request(port, {
      method: 'POST', path: '/api/browser/visit', headers: { 'X-CodeCraft-Token': 'test-token-xyz' },
      body: { url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill', title: 'GitHub repo' },
    });
    const recent = await request(port, { method: 'GET', path: '/api/browser/recent', headers: { 'X-CodeCraft-Token': 'test-token-xyz' } });
    assert.strictEqual(recent.body.recent.length, 2);
    assert.strictEqual(recent.body.recent[0].url, 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill', 'most recent visit should be first');
    assert.strictEqual(recent.body.recent[1].url, 'https://mdskills.ai/skills/ui-ux-pro-max');
    console.log('✓ /recent returns real visit history, newest first');

    // Fail-closed check: an app instance built with no token configured at all
    // must reject everything, not silently allow it.
    delete process.env.BROWSER_EXTENSION_TOKEN;
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('../api/browserRoutes')];
    const unconfiguredRoutes = require('../api/browserRoutes');
    const app2 = express();
    app2.use(express.json());
    app2.use('/api/browser', unconfiguredRoutes);
    const server2 = await new Promise((resolve) => { const s = app2.listen(0, () => resolve(s)); });
    const port2 = server2.address().port;
    try {
      const unconfigured = await request(port2, { method: 'POST', path: '/api/browser/visit', body: { url: 'https://evil.example.com' } });
      assert.strictEqual(unconfigured.status, 503, 'with no token configured server-side, requests must fail closed, not be silently allowed');
      console.log('✓ with no token configured on the server, the endpoint fails closed (503), never silently open');
    } finally {
      server2.close();
    }
  } finally {
    server.close();
  }

  console.log('\nAll browser extension API checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
