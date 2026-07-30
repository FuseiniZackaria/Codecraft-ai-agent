const path = require('path');
const toolRegistry = require('../../tools/ToolRegistry');
const { registerAgent, unregisterAgent } = require('../../agents/registry');
const { installSDK } = require('./sdk');

installSDK();

/**
 * Activator - single responsibility: dynamically require a skill's entry
 * file and wire up whatever it exports into the running system (tools into
 * ToolRegistry, an agent into the agents registry). This is what makes
 * "no restart needed" real - the skill's code starts running in this same
 * Node process the moment activate() is called.
 *
 * Entry file contract: `module.exports = { tools?: [...], agent?: instance }`
 */
class Activator {
  activate(skillId, entryFilePath) {
    const resolved = require.resolve(entryFilePath);
    delete require.cache[resolved]; // cache-bust so reinstall/update picks up new code
    const mod = require(resolved);

    const registered = { tools: [], agent: null };

    for (const tool of mod.tools || []) {
      if (!tool.name || typeof tool.run !== 'function') {
        throw new Error(`Skill "${skillId}" exported an invalid tool (missing name or run function)`);
      }
      const fullName = `${skillId}.${tool.name}`;
      toolRegistry.register(fullName, {
        permission: tool.permission || null,
        irreversible: !!tool.irreversible,
        run: tool.run,
      });
      registered.tools.push(fullName);
    }

    if (mod.agent) {
      const instance = typeof mod.agent === 'function' ? new mod.agent() : mod.agent;
      registerAgent(skillId, instance);
      registered.agent = skillId;
    }

    return registered;
  }

  deactivate(skillId) {
    const removedTools = toolRegistry.unregisterByPrefix(skillId);
    unregisterAgent(skillId);
    return { removedTools };
  }

  resolveEntryPath(packageDir, entryRelativePath) {
    return path.join(packageDir, entryRelativePath);
  }
}

module.exports = { Activator };
