const { openFile } = require('../../../core/computerOperator/openFile');
const { getAllowedRoots } = require('../../../core/computerOperator/pathSafety');

module.exports = {
  name: 'openFile',
  permission: 'computer.read',
  // Safe file types only (executables/scripts are hard-blocked inside
  // openFile() itself, not gated - there's no approval option for those at
  // all). Opening a document/image/media file the user already has full
  // access to is equivalent to them double-clicking it themselves, not an
  // action taken on anyone else's behalf - same non-gated spirit as
  // Stage 1/2's read-only search and listing.
  irreversible: false,

  /**
   * @param {object} args
   * @param {string} args.filePath - full path to the file to open
   */
  async run({ filePath } = {}) {
    const allowedRoots = getAllowedRoots();
    if (allowedRoots.length === 0) {
      throw new Error(
        'No folders are configured for computer access yet. Set COMPUTER_ALLOWED_ROOTS in .env to the folder(s) you want this agent able to access, then restart the server.'
      );
    }
    return openFile(filePath);
  },
};
