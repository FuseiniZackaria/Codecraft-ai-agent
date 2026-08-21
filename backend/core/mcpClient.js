// Real MCP client, speaking JSON-RPC 2.0 over plain HTTP.
//
// PROTOCOL VERSION NOTE (important, not decorative): as of this writing the
// MCP spec is mid-transition. A 2026-07-28 release candidate retires the
// stateful initialize/initialized handshake and Mcp-Session-Id entirely in
// favor of a stateless per-request model. That RC is three weeks old and
// almost certainly isn't what most currently-deployed servers speak yet -
// so this client targets the stable, currently-common protocol: a real
// initialize handshake, an initialized notification, then tools/list and
// tools/call. A server built strictly to the brand-new stateless RC may
// not respond to this handshake the same way. If a specific server fails
// here, that's the most likely reason.
//
// Also not implemented: SSE-streamed responses. This client expects a
// single JSON response per request (a valid, spec-permitted mode for
// servers that don't need to stream), not an event-stream.

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'codecraft-ai', version: '1.0.0' };
const DEFAULT_TIMEOUT_MS = 8000;

class MCPError extends Error {
  constructor(message, { code = null, data = null } = {}) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.data = data;
  }
}

async function rpcCall(serverUrl, method, params, { id = 1, sessionId = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  try {
    const res = await fetch(serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal,
    });

    const returnedSessionId = res.headers.get('mcp-session-id') || sessionId;

    if (!res.ok) {
      throw new MCPError(`Server responded with HTTP ${res.status}`, { code: res.status });
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      throw new MCPError(`Server sent a non-JSON response (content-type "${contentType}") - streaming (SSE) responses aren't supported by this client`);
    }

    const body = await res.json();
    if (body.error) {
      throw new MCPError(body.error.message || 'MCP server returned an error', { code: body.error.code, data: body.error.data });
    }
    return { result: body.result, sessionId: returnedSessionId };
  } catch (err) {
    if (err instanceof MCPError) throw err;
    if (err.name === 'AbortError') throw new MCPError('Request timed out');
    throw new MCPError(err.message);
  } finally {
    clearTimeout(timer);
  }
}

async function sendNotification(serverUrl, method, sessionId) {
  // Notifications carry no id and expect no meaningful response body - a
  // server may reply 202 Accepted with nothing, which is valid here.
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  try {
    await fetch(serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method }),
    });
  } catch {
    // Non-fatal: some servers don't require this notification to proceed.
  }
}

/**
 * Performs the real initialize handshake and returns everything a caller
 * needs to make further calls (session id if the server issued one, and
 * whatever protocol version it actually negotiated back).
 */
async function connect(serverUrl) {
  const { result, sessionId } = await rpcCall(serverUrl, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  }, { id: 1 });

  await sendNotification(serverUrl, 'notifications/initialized', sessionId);

  return {
    serverUrl,
    sessionId: sessionId || null,
    negotiatedProtocolVersion: result?.protocolVersion || null,
    serverInfo: result?.serverInfo || null,
    capabilities: result?.capabilities || {},
  };
}

async function listTools(session) {
  const { result } = await rpcCall(session.serverUrl, 'tools/list', {}, { id: 2, sessionId: session.sessionId });
  return Array.isArray(result?.tools) ? result.tools : [];
}

async function callTool(session, name, args = {}) {
  const { result } = await rpcCall(
    session.serverUrl,
    'tools/call',
    { name, arguments: args },
    { id: 3, sessionId: session.sessionId }
  );
  return result;
}

module.exports = { connect, listTools, callTool, MCPError, PROTOCOL_VERSION };
