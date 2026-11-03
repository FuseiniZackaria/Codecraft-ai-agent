const { findContacts } = require('../../../core/browserAutomation/browserSession');

module.exports = {
  permission: 'browser.read',
  irreversible: false,
  run: async (args) => findContacts(args.url),
};
