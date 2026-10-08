const { applyForJob } = require('../../../core/browserAutomation/browserSession');

module.exports = {
  permission: 'browser.write',
  // Marked irreversible - submitting a job application cannot be undone.
  // This action only runs after explicit human approval on the Tasks page.
  irreversible: true,
  run: async (args) => applyForJob(args.fields, args.submitSelector),
};
