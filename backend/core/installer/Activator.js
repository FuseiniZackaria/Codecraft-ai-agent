const fs = require('fs');
const path = require('path');
const toolRegistry = require('../../tools/ToolRegistry');
const guidanceRegistry = require('../guidanceRegistry');
const { registerAgent, unregisterAgent } = require('../../agents/registry');
const { installSDK } = require('./sdk');

installSDK();

/**
 * Activator - single responsibility: take an installed skill package and
 * wire it into the running system. Two paths depending on manifest.kind:
 *
 *   "tool"     - dynamically require() the entry file and register
 *                whatever it exports (tools into ToolRegistry, an agent
 *                into the agents registry). This is what makes "no
 *                restart needed" real for executable skills.
 *   "guidance" - read the guidance file's text and register it into
 *                GuidanceRegistry. Never executed as code - it's read,
 *                not run.
 *
 * Entry file contract (tool skills): `module.exports = { tools?: [...], agent?: instance }`
 */
class Activator {
  /**
   * @param {string} skillId
   * @param {string} packageDir - the skill's installed directory
   * @param {object} manifest - the loaded, validated manifest
   */
  activate(skillId, packageDir, manifest) {
    if (manifest.kind === 'guidance') {
      return this._activateGuidance(skillId, packageDir, manifest);
    }
    return this._activateTool(skillId, packageDir, manifest);
  }

  _activateTool(skillId, packageDir, manifest) {
    const entryFilePath = this.resolveEntryPath(packageDir, manifest.entry);
    const resolved = require.resolve(entryFilePath);
    delete require.cache[resolved]; // cache-bust so reinstall/update picks up new code
    const mod = require(resolved);

    const registered = { tools: [], agent: null, guidance: false };

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

  _activateGuidance(skillId, packageDir, manifest) {
    const guidancePath = path.join(packageDir, manifest.guidanceFile);
    if (!fs.existsSync(guidancePath)) {
      throw new Error(`Skill "${skillId}" declares guidanceFile "${manifest.guidanceFile}" but it doesn't exist`);
    }
    const content = fs.readFileSync(guidancePath, 'utf-8');
    guidanceRegistry.register(skillId, { name: manifest.name, content, triggers: manifest.triggers });
    return { tools: [], agent: null, guidance: true };
  }

  deactivate(skillId) {
    const removedTools = toolRegistry.unregisterByPrefix(skillId);
    unregisterAgent(skillId);
    guidanceRegistry.unregister(skillId);
    return { removedTools };
  }

  resolveEntryPath(packageDir, entryRelativePath) {
    return path.join(packageDir, entryRelativePath);
  }
}

module.exports = { Activator };
