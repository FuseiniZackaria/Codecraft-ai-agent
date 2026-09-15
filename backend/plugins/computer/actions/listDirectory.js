const { listDirectory } = require('../../../core/computerOperator/directoryInspect');
const { getAllowedRoots } = require('../../../core/computerOperator/pathSafety');
const config = require('../../../config');

module.exports = {
  name: 'listDirectory',
  permission: 'computer.read',
  irreversible: false, // read-only, non-destructive - no approval gate needed

  /**
   * @param {object} args
   * @param {string} args.dirPath - the specific folder to list (must be an allowed root or a subfolder of one)
   */
  async run({ dirPath } = {}) {
    const allowedRoots = getAllowedRoots();
    if (allowedRoots.length === 0) {
      throw new Error(
        'No folders are configured for computer access yet. Set COMPUTER_ALLOWED_ROOTS in .env to the folder(s) you want this agent able to access, then restart the server.'
      );
    }
    return listDirectory(dirPath, { maxResults: config.computerOperator.maxSearchResults });
  },
};
