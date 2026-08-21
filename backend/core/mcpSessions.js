const sessions = new Map(); // serverUrl -> { session, tools, connectedAt }

function save(serverUrl, session, tools) {
  sessions.set(serverUrl, { session, tools, connectedAt: new Date().toISOString() });
}

function get(serverUrl) {
  return sessions.get(serverUrl) || null;
}

function list() {
  return [...sessions.entries()].map(([serverUrl, v]) => ({ serverUrl, tools: v.tools, connectedAt: v.connectedAt }));
}

function _reset() {
  sessions.clear();
}

module.exports = { save, get, list, _reset };
