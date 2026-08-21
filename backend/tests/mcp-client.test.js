const assert = require('assert');
const http = require('http');
const express = require('express');
const mcpClient = require('../core/mcpClient');

process.env.BROWSER_EXTENSION_TOKEN = 'mcp-test-token';
delete require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../core/mcpSessions')];
delete require.cache[require.resolve('../api/mcpRoutes')];
const mcpSessions = require('../core/mcpSessions');
const mcpRoutes = require('../api/mcpRoutes');

const ISSUED_SESSION_ID = 'mock-session-abc123';

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : null));
  });
}

function buildMockMCPServer() {
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const msg = await readBody(req);

    if (msg && msg.method === 'notifications/initialized' && msg.id === undefined) {
      res.writeHead(202);
      return res.end();
    }
    const respond = (result) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': ISSUED_SESSION_ID });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    };
    const respondError = (code, message) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } }));
    };

    if (msg.method === 'initialize') {
      return respond({ protocolVersion: '2025-06-18', serverInfo: { name: 'Mock MCP Server', version: '1.0.0' }, capabilities: { tools: {} } });
    }
    const sentSession = req.headers['mcp-session-id'];
    if (sentSession !== ISSUED_SESSION_ID) {
      return respondError(-32000, 'Missing or invalid session - call initialize first');
    }
    if (msg.method === 'tools/list') {
      return respond({ tools: [
        { name: 'echo', description: 'Echoes back the input message' },
        { name: 'add', description: 'Adds two numbers' },
      ] });
    }
    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      if (name === 'echo') return respond({ content: [{ type: 'text', text: `Echo: ${args.message}` }] });
      if (name === 'add') return respond({ content: [{ type: 'text', text: String(args.a + args.b) }] });
      return respondError(-32601, `Unknown tool: ${name}`);
    }
    respondError(-32601, `Unknown method: ${msg.method}`);
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

async function run() {
  // --- Protocol-level: real client against a real, spec-faithful mock server ---
  const mockServer = buildMockMCPServer();
  await new Promise((resolve) => mockServer.listen(0, resolve));
  const mockPort = mockServer.address().port;
  const mockUrl = `http://localhost:${mockPort}`;

  const session = await mcpClient.connect(mockUrl);
  assert.strictEqual(session.sessionId, ISSUED_SESSION_ID, 'the real session id issued by the server should be captured');
  assert.strictEqual(session.serverInfo.name, 'Mock MCP Server', 'real server info should be genuinely parsed from the handshake response');
  console.log('✓ a real initialize handshake against a real server succeeds and captures the real session');

  const tools = await mcpClient.listTools(session);
  assert.strictEqual(tools.length, 2);
  assert.deepStrictEqual(tools.map((t) => t.name), ['echo', 'add']);
  console.log('✓ tools/list returns the real tool list from the server');

  const echoResult = await mcpClient.callTool(session, 'echo', { message: 'hello' });
  assert.strictEqual(echoResult.content[0].text, 'Echo: hello');
  const addResult = await mcpClient.callTool(session, 'add', { a: 7, b: 35 });
  assert.strictEqual(addResult.content[0].text, '42', 'a real remote computation should come back correctly');
  console.log('✓ tools/call genuinely invokes the real server and returns real results');

  await assert.rejects(
    () => mcpClient.callTool(session, 'nonexistent', {}),
    (err) => err.message.includes('Unknown tool'),
    'a real JSON-RPC error from the server should surface as a real thrown error, not be silently swallowed'
  );
  console.log('✓ a real JSON-RPC error response is correctly surfaced, not swallowed');

  await assert.rejects(
    () => mcpClient.listTools({ serverUrl: mockUrl, sessionId: null }),
    'a request with no valid session should be rejected, proving session enforcement is real, not decorative'
  );
  console.log('✓ calling without a valid session is correctly rejected by the real server and surfaced as an error');

  mockServer.close();

  // --- Route layer: the actual API a human/UI would call ---
  mcpSessions._reset();
  const routeMockServer = buildMockMCPServer();
  await new Promise((resolve) => routeMockServer.listen(0, resolve));
  const routeMockPort = routeMockServer.address().port;
  const routeMockUrl = `http://localhost:${routeMockPort}`;

  const app = express();
  app.use(express.json());
  app.use('/api/mcp', mcpRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  const headers = { 'X-CodeCraft-Token': 'mcp-test-token' };

  const noToken = await httpReq(port, '/api/mcp/connect', { method: 'POST', body: { url: routeMockUrl } });
  assert.strictEqual(noToken.status, 401, 'the MCP route must be protected by the same token as browser routes');

  const connectRes = await httpReq(port, '/api/mcp/connect', { method: 'POST', headers, body: { url: routeMockUrl } });
  assert.strictEqual(connectRes.status, 200);
  assert.strictEqual(connectRes.body.tools.length, 2, 'the real tool list should flow through the route, not just the module');
  console.log('✓ POST /api/mcp/connect performs a real handshake and returns the real tool list');

  const callRes = await httpReq(port, '/api/mcp/call', { method: 'POST', headers, body: { url: routeMockUrl, tool: 'add', args: { a: 10, b: 15 } } });
  assert.strictEqual(callRes.status, 200);
  assert.strictEqual(callRes.body.result.content[0].text, '25');
  console.log('✓ POST /api/mcp/call reuses the saved session and returns the real result');

  const sessionsRes = await httpReq(port, '/api/mcp/sessions', { headers });
  assert.strictEqual(sessionsRes.body.sessions.length, 1);
  assert.strictEqual(sessionsRes.body.sessions[0].serverUrl, routeMockUrl);
  console.log('✓ GET /api/mcp/sessions reflects the real saved connection');

  const badUrl = await httpReq(port, '/api/mcp/connect', { method: 'POST', headers, body: { url: 'http://localhost:1' } });
  assert.strictEqual(badUrl.status, 502, 'an unreachable server should fail cleanly as a 502, not crash the route');
  assert.strictEqual(badUrl.body.ok, false);
  console.log('✓ a genuinely unreachable server is reported as a clean 502, not a crash');

  server.close();
  routeMockServer.close();

  console.log('\nAll MCP client checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
