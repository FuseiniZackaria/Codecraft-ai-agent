const { findDuplicateFiles } = require('../../../core/computerOperator/duplicateDetection');
const { getAllowedRoots } = require('../../../core/computerOperator/pathSafety');

module.exports = {
  name: 'findDuplicateFiles',
  permission: 'computer.read',
  irreversible: false, // read-only, non-destructive - no approval gate needed

  /**
   * @param {object} args
   * @param {number} [args.maxResults]
   */
  async run({ maxResults } = {}) {
    const allowedRoots = getAllowedRoots();
    if (allowedRoots.length === 0) {
      throw new Error(
        'No folders are configured for computer access yet. Set COMPUTER_ALLOWED_ROOTS in .env to the folder(s) you want this agent able to access, then restart the server.'
      );
    }
    return findDuplicateFiles({ maxResults: maxResults || 20 });
  },
};