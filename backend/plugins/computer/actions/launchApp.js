const { launchApp } = require('../../../core/computerOperator/appLaunch');

/**
 * Non-gated, same spirit as openFile/openFolder - launching a NAMED,
 * pre-approved app (from COMPUTER_ALLOWED_APPS) is equivalent to the user
 * double-clicking it themselves. Not irreversible/destructive, so no
 * approval gate - the real safety boundary is appLaunch.js's allowlist
 * check, which happens before this ever runs.
 */
module.exports = {
  permission: 'computer.read',
  irreversible: false,
  run: async (args) => launchApp(args.exePath),
};