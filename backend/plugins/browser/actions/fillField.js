const { fillField } = require('../../../core/browserAutomation/browserSession');

module.exports = {
  permission: 'browser.write',
  irreversible: false, // filling alone is reversible - only submit is irreversible
  run: async (args) => fillField(args.selector, args.value),
};
