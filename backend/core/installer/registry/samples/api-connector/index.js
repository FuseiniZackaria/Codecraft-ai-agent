// Configured entirely via .env, matching every other integration in this
// project (Composio, Gmail, WhatsApp, YouTube). This connects to ONE
// external API at a time - connecting to a second, different API means
// reconfiguring these values (or building a second, differently-named
// skill), not running two instances simultaneously.
const BASE_URL = process.env.API_CONNECTOR_BASE_URL || '';
const AUTH_TOKEN = process.env.API_CONNECTOR_AUTH_TOKEN || null;

async function request(method, path, body) {
  if (!BASE_URL) {
    throw new Error('API_CONNECTOR_BASE_URL is not configured in .env - set it before using this skill.');
  }
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'CodeCraft-AI' };
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await res.json() : await res.text();

  if (!res.ok) {
    const snippet = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200);
    throw new Error(`API responded with HTTP ${res.status}: ${snippet}`);
  }
  return { status: res.status, data };
}

module.exports = {
  tools: [
    {
      name: 'get',
      permission: 'network',
      irreversible: false, // read-only by construction - this tool only ever issues GET
      run: async ({ path }) => request('GET', path),
    },
    {
      name: 'call',
      permission: 'network',
      // Any method, including writes - a generic connector has no way to
      // know which endpoints are safe, so every non-GET call needs
      // approval, same safe-default treatment as MCP tools get.
      irreversible: true,
      run: async ({ method, path, body }) => request(method || 'POST', path, body),
    },
  ],
};
