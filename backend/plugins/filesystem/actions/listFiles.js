const fs = require('fs');
const path = require('path');
const { resolveProjectRoot } = require('../workspaceSafety');

function walk(dir, base = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(path.join(dir, entry.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

module.exports = {
  name: 'listFiles',
  permission: 'filesystem',
  irreversible: false,

  async run({ projectId }) {
    if (!projectId) throw new Error('listFiles requires "projectId"');
    const projectRoot = resolveProjectRoot(projectId);
    return { files: walk(projectRoot) };
  },
};
