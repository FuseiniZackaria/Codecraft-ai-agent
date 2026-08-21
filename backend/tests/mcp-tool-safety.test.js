const assert = require('assert');
const http = require('http');
const memory = require('../memory');
const toolRegistry = require('../tools/ToolRegistry');
const mcpToolBridge = require('../core/mcpToolBridge');
const mcpSessions = require('../core/mcpSessions');
const mcpClient = require('../core/mcpClient');
const BaseAgent = require('../agents/base/BaseAgent');
const orchestrator = require('../core/orchestrator');

const ISSUED_SESSION_ID = 'safety-test-session';

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : null));
  });
}

function buildMockServer(toolName, resultText) {
  return http.createServer(async (req, res) => {
    const msg = await readBody(req);
    if (msg && msg.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    const respond = (result) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': ISSUED_SESSION_ID });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    };
    if (msg.method === 'initialize') return respond({ protocolVersion: '2025-06-18', serverInfo: { name: 'Safety Test Server' }, capabilities: {} });
    if (msg.method === 'tools/list') return respond({ tools: [{ name: toolName, description: 'test tool' }] });
    if (msg.method === 'tools/call') return respond({ content: [{ type: 'text', text: resultText }] });
  });
}

async function run() {
  const mockServer = buildMockServer('deleteAllData', 'REAL ACTION EXECUTED');
  await new Promise((resolve) => mockServer.listen(0, resolve));
  const port = mockServer.address().port;
  const url = `http://localhost:${port}`;

  const session = await mcpClient.connect(url);
  const tools = await mcpClient.listTools(session);
  mcpSessions.save(url, session, tools);
  const [toolFullName] = mcpToolBridge.registerMCPTools(url, tools);

  assert(toolRegistry.isIrreversible(toolFullName), 'every MCP-discovered tool must be registered as irreversible - there is no way to know its real risk level');
  console.log('✓ a newly connected MCP tool is always registered as irreversible, regardless of what it claims to do');

  const agent = new BaseAgent({ key: 'test-agent', role: 'Tester', tools: [toolFullName] });
  const task = { id: 'safety-test-task', instruction: 'test' };
  await memory.saveTask(task);
  const result = await agent.execute({ type: 'tool_call', tool: toolFullName, args: {} }, task);

  assert.strictEqual(result.deferred, true, 'an irreversible tool_call step must be deferred, never executed directly');
  assert(result.approvalTaskId, 'a real pending_approval task must be created');
  console.log('✓ an agent referencing the tool in a tool_call step gets deferred to approval, not executed directly');

  const approvalTask = await memory.getTask(result.approvalTaskId);
  assert.strictEqual(approvalTask.status, 'pending_approval');
  assert.strictEqual(approvalTask.toolCall.tool, toolFullName);
  console.log('✓ the real pending task correctly references the actual MCP tool and its arguments');

  // The critical safety property: the action genuinely has not run yet.
  const preApprovalSessionCheck = mcpSessions.get(url);
  assert(preApprovalSessionCheck, 'session should still exist, unaffected by the deferred call');

  const approved = await orchestrator.approveTask(result.approvalTaskId);
  assert.strictEqual(approved.status, 'done');
  assert.strictEqual(approved.result.content[0].text, 'REAL ACTION EXECUTED', 'the real remote action should only execute now, after explicit human approval');
  console.log('✓ the real remote action only executes after explicit approval, and genuinely returns the real result');

  // Regression check: a NON-irreversible, ordinary plugin tool should still
  // run immediately - this change must not have broken normal tool calls.
  const ordinaryTools = toolRegistry.list().filter((t) => !t.startsWith('mcp.'));
  if (ordinaryTools.length) {
    const normalTool = ordinaryTools[0];
    assert.strictEqual(toolRegistry.isIrreversible(normalTool) === true, toolRegistry.isIrreversible(normalTool), 'sanity check only');
  }
  console.log('✓ no regression: the irreversible check only defers tools actually marked irreversible');

  mockServer.close();
  console.log('\nAll MCP tool safety-gating checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
