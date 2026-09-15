const { screenshot } = require('../../../core/browserAutomation/browserSession');

module.exports = {
  permission: 'browser.read',
  irreversible: false,
  run: async () => screenshot(),
};