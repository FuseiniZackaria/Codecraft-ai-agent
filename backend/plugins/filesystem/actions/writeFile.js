const fs = require('fs');
const path = require('path');
const { resolveSafePath, ensureProjectDir } = require('../workspaceSafety');

module.exports = {
  name: 'writeFile',
  permission: 'filesystem',
  irreversible: false, // local, sandboxed, and trivially reversible - no approval gate needed

  async run({ projectId, path: relativePath, content, encoding = 'utf-8' }) {
    if (!projectId || !relativePath || content == null) {
      throw new Error('writeFile requires "projectId", "path", and "content"');
    }
    ensureProjectDir(projectId);
    const target = resolveSafePath(projectId, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, encoding);
    return { path: relativePath, bytes: fs.statSync(target).size };
  },
};
