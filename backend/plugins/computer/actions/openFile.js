const target = require('../../../core/computerOperator/target');

// open a file in its normal app (programs/scripts are always refused). Runs on the computer of the person asking (their Computer Helper),
// or on this server in the owner's local mode - see core/computerOperator/target.js.
module.exports = {
  name: 'openFile',
  permission: 'computer.read',
  irreversible: false,
  run: async ({ filePath } = {}) => target.call('openFile', { filePath }),
};
