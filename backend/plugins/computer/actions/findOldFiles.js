const { findOldFiles } = require('../../../core/computerOperator/oldFileAnalysis');
const { getAllowedRoots } = require('../../../core/computerOperator/pathSafety');

module.exports = {
  name: 'findOldFiles',
  permission: 'computer.read',
  irreversible: false, // read-only, non-destructive - no approval gate needed

  /**
   * @param {object} args
   * @param {number} [args.minAgeDays] - only include files last modified at least this many days ago
   * @param {number} [args.maxResults]
   */
  async run({ minAgeDays, maxResults } = {}) {
    const allowedRoots = getAllowedRoots();
    if (allowedRoots.length === 0) {
      throw new Error(
        'No folders are configured for computer access yet. Set COMPUTER_ALLOWED_ROOTS in .env to the folder(s) you want this agent able to access, then restart the server.'
      );
    }
    return findOldFiles({ minAgeDays: minAgeDays || 0, maxResults: maxResults || 20 });
  },
};

