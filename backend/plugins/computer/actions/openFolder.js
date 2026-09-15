const { openFolder } = require('../../../core/computerOperator/openFolder');
const { getAllowedRoots } = require('../../../core/computerOperator/pathSafety');

module.exports = {
  name: 'openFolder',
  permission: 'computer.read',
  // Opening a folder just shows its contents in Explorer/Finder - no code
  // execution risk at all (unlike openFile, there's nothing to block by
  // extension). Same non-gated spirit as every other read-only/view action
  // in Stages 1-3.
  irreversible: false,

  /**
   * @param {object} args
   * @param {string} args.dirPath - full path to the folder to open
   */
  async run({ dirPath } = {}) {
    const allowedRoots = getAllowedRoots();
    if (allowedRoots.length === 0) {
      throw new Error(
        'No folders are configured for computer access yet. Set COMPUTER_ALLOWED_ROOTS in .env to the folder(s) you want this agent able to access, then restart the server.'
      );
    }
    return openFolder(dirPath);
  },
};