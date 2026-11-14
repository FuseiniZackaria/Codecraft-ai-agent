const target = require('../../../core/computerOperator/target');

// start an app from the allowed-apps list only. Runs on the computer of the person asking (their Computer Helper),
// or on this server in the owner's local mode - see core/computerOperator/target.js.
module.exports = {
  name: 'launchApp',
  permission: 'computer.read',
  irreversible: false,
  run: async ({ exePath } = {}) => target.call('launchApp', { exePath }),
};
