const target = require('../../../core/computerOperator/target');

// filename substring search inside the shared folders. Runs on the computer of the person asking (their Computer Helper),
// or on this server in the owner's local mode - see core/computerOperator/target.js.
module.exports = {
  name: 'searchFiles',
  permission: 'computer.read',
  irreversible: false,
  run: async ({ query, root, extensions, caseSensitive } = {}) => target.call('searchFiles', { query, root, extensions, caseSensitive }),
};
