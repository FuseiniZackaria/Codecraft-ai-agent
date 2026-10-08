const { clickElement } = require('../../../core/browserAutomation/browserSession');

module.exports = {
  permission: 'browser.write',
  irreversible: false,
  run: async (args) => clickElement(args.selector),
};
