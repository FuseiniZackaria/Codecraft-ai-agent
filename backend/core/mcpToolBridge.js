const toolRegistry = require('../tools/ToolRegistry');
const mcpClient = require('./mcpClient');
const mcpSessions = require('./mcpSessions');

function originSlug(serverUrl) {
  try {
    return new URL(serverUrl).hostname.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  } catch {
    return 'unknown';
  }
}

/**
 * Registers each tool from a connected MCP server into ToolRegistry as
 * "mcp.<host-slug>.<toolName>". Always irreversible:true - an MCP server
 * discovered from some website is an unvetted external source, and there's
 * no reliable way to know which of its tools are safe to auto-run and
 * which aren't. Treating all of them as needing approval is the safe
 * default, matching how this app already treats gmail.sendEmail and
 * reddit.postComment - deferred to a human, never assumed safe.
 */
function registerMCPTools(serverUrl, tools) {
  const slug = originSlug(serverUrl);
  const registered = [];

  for (const tool of tools) {
    const fullName = `mcp.${slug}.${tool.name}`;
    toolRegistry.register(fullName, {
      irreversible: true,
      run: async (args) => {
        const entry = mcpSessions.get(serverUrl);
        if (!entry) throw new Error(`No active MCP session for ${serverUrl} - reconnect first.`);
        return mcpClient.callTool(entry.session, tool.name, args || {});
      },
    });
    registered.push(fullName);
  }

  return registered;
}

function unregisterMCPTools(serverUrl) {
  const slug = originSlug(serverUrl);
  return toolRegistry.unregisterByPrefix(`mcp.${slug}`);
}

module.exports = { registerMCPTools, unregisterMCPTools, originSlug };
