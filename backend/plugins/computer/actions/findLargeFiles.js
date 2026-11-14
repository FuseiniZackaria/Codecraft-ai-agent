const target = require('../../../core/computerOperator/target');

// biggest files. Runs on the computer of the person asking (their Computer Helper),
// or on this server in the owner's local mode - see core/computerOperator/target.js.
module.exports = {
  name: 'findLargeFiles',
  permission: 'computer.read',
  irreversible: false,
  run: async ({ minSizeMB, maxResults } = {}) => target.call('findLargeFiles', { minSizeMB, maxResults }),
};
