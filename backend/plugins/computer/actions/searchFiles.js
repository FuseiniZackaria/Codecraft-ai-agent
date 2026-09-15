const { searchFiles } = require('../../../core/computerOperator/fileSearch');
const { getAllowedRoots } = require('../../../core/computerOperator/pathSafety');
const config = require('../../../config');

module.exports = {
  name: 'searchFiles',
  permission: 'computer.read',
  irreversible: false, // read-only, non-destructive - no approval gate needed

  /**
   * @param {object} args
   * @param {string} args.query - filename substring to search for
   * @param {string} [args.root] - restrict to one specific allowed folder instead of all of them
   * @param {string[]} [args.extensions]
   * @param {boolean} [args.caseSensitive]
   */
  async run({ query, root, extensions, caseSensitive } = {}) {
    const allowedRoots = getAllowedRoots();
    if (allowedRoots.length === 0) {
      throw new Error(
        'No folders are configured for computer access yet. Set COMPUTER_ALLOWED_ROOTS in .env to the folder(s) you want this agent able to search, then restart the server.'
      );
    }

    return searchFiles({
      query,
      roots: root ? [root] : undefined,
      extensions,
      caseSensitive,
      maxResults: config.computerOperator.maxSearchResults,
    });
  },
};