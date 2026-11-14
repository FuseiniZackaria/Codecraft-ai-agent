const target = require('../../../core/computerOperator/target');

// files not changed in a while. Runs on the computer of the person asking (their Computer Helper),
// or on this server in the owner's local mode - see core/computerOperator/target.js.
module.exports = {
  name: 'findOldFiles',
  permission: 'computer.read',
  irreversible: false,
  run: async ({ minAgeDays, maxResults } = {}) => target.call('findOldFiles', { minAgeDays, maxResults }),
};
