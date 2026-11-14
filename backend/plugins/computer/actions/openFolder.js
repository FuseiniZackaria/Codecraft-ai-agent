const target = require('../../../core/computerOperator/target');

// open a folder in File Explorer. Runs on the computer of the person asking (their Computer Helper),
// or on this server in the owner's local mode - see core/computerOperator/target.js.
module.exports = {
  name: 'openFolder',
  permission: 'computer.read',
  irreversible: false,
  run: async ({ dirPath } = {}) => target.call('openFolder', { dirPath }),
};
