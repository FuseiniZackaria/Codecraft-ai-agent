/**
 * ToolRegistry
 *
 * Global registry that plugin actions are loaded into at startup.
 * Agents look up tools by name (e.g. "gmail.sendEmail") without needing to
 * know which plugin file implements them - this is what keeps agents/core
 * decoupled from individual plugins.
 */
class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(fullName, { permission, run, irreversible = false }) {
    this.tools.set(fullName, { permission, run, irreversible });
  }

  /** Removes a tool - used when a skill is disabled or uninstalled at runtime. */
  unregister(fullName) {
    return this.tools.delete(fullName);
  }

  /** Removes every tool whose name starts with "prefix." - e.g. all of a skill's tools at once. */
  unregisterByPrefix(prefix) {
    const removed = [];
    for (const key of this.tools.keys()) {
      if (key.startsWith(`${prefix}.`)) {
        this.tools.delete(key);
        removed.push(key);
      }
    }
    return removed;
  }

  has(fullName) {
    return this.tools.has(fullName);
  }

  isIrreversible(fullName) {
    const tool = this.tools.get(fullName);
    return !!(tool && tool.irreversible);
  }

  list() {
    return Array.from(this.tools.keys());
  }

  /**
   * @param {string} fullName - e.g. "gmail.sendEmail"
   * @param {object} args
   * @param {object} context - includes caller role for permission checks
   */
  async call(fullName, args, context = {}) {
    const tool = this.tools.get(fullName);
    if (!tool) throw new Error(`Tool not found: ${fullName}`);

    // RBAC check placeholder - in production this checks context.role against
    // tool.permission via the roles/user_roles tables from the schema.
    if (tool.permission && context.role === 'restricted') {
      throw new Error(`Permission denied for tool: ${fullName}`);
    }

    return tool.run(args, context);
  }
}

module.exports = new ToolRegistry();
