const { readPage } = require('../../../core/browserAutomation/browserSession');

module.exports = {
  permission: 'browser.read',
  irreversible: false,
  run: async () => readPage(),
};