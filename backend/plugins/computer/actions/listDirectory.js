const target = require('../../../core/computerOperator/target');

// what is inside one shared folder. Runs on the computer of the person asking (their Computer Helper),
// or on this server in the owner's local mode - see core/computerOperator/target.js.
module.exports = {
  name: 'listDirectory',
  permission: 'computer.read',
  irreversible: false,
  run: async ({ dirPath } = {}) => target.call('listDirectory', { dirPath }),
};
