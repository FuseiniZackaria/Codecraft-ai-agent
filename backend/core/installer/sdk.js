const BaseAgent = require('../../agents/base/BaseAgent');

/**
 * Exposes core building blocks to dynamically-loaded skill code via a
 * global, since a skill's files live outside this project's own directory
 * tree and can't reliably `require('../../../agents/base/BaseAgent')` by
 * relative path. Skills that just export `tools` don't need this at all -
 * it's only for skills that export a full `agent` extending BaseAgent.
 */
function installSDK() {
  global.CodeCraftSDK = { BaseAgent };
}

module.exports = { installSDK };
