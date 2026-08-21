const path = require('path');
const AdmZip = require('adm-zip');
const { resolveProjectRoot } = require('../workspaceSafety');

module.exports = {
  name: 'zipProject',
  permission: 'filesystem',
  irreversible: false,

  async run({ projectId }) {
    if (!projectId) throw new Error('zipProject requires "projectId"');
    const projectRoot = resolveProjectRoot(projectId);
    const zip = new AdmZip();
    zip.addLocalFolder(projectRoot);
    const zipPath = path.join(projectRoot, '..', `${projectId}.zip`);
    zip.writeZip(zipPath);
    return { zipPath, projectId };
  },
};
