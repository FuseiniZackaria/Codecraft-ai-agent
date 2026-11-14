const target = require('../../../core/computerOperator/target');

// byte-for-byte duplicate files. Runs on the computer of the person asking (their Computer Helper),
// or on this server in the owner's local mode - see core/computerOperator/target.js.
module.exports = {
  name: 'findDuplicateFiles',
  permission: 'computer.read',
  irreversible: false,
  run: async ({ maxResults } = {}) => target.call('findDuplicateFiles', { maxResults }),
};
