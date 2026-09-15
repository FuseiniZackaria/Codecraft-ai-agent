const { findLargeFiles } = require('../../../core/computerOperator/largeFileAnalysis');
const { getAllowedRoots } = require('../../../core/computerOperator/pathSafety');

module.exports = {
  name: 'findLargeFiles',
  permission: 'computer.read',
  irreversible: false, // read-only, non-destructive - no approval gate needed

  /**
   * @param {object} args
   * @param {number} [args.minSizeMB] - only include files at or above this size in MB
   * @param {number} [args.maxResults]
   */
  async run({ minSizeMB, maxResults } = {}) {
    const allowedRoots = getAllowedRoots();
    if (allowedRoots.length === 0) {
      throw new Error(
        'No folders are configured for computer access yet. Set COMPUTER_ALLOWED_ROOTS in .env to the folder(s) you want this agent able to access, then restart the server.'
      );
    }
    const minSizeBytes = minSizeMB ? minSizeMB * 1024 * 1024 : 0;
    return findLargeFiles({ minSizeBytes, maxResults: maxResults || 20 });
  },
};