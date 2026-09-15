const { navigate } = require('../../../core/browserAutomation/browserSession');

module.exports = {
  permission: 'browser.read',
  irreversible: false,
  run: async (args) => navigate(args.url),
};