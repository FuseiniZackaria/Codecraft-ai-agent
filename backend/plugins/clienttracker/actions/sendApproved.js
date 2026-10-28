const clientTracker = require('../../../core/clientTracker');

module.exports = {
  name: 'sendApproved',
  description: 'Send a client-tracker email to a high-value lead after the user approved it.',
  permission: 'gmail.send',
  irreversible: true,

  // Only the approval flow (orchestrator.approveTask) may run this - it sets
  // approvedTaskId. The send still goes through the tracker's Do Not Contact,
  // pause and daily-cap checks.
  async run({ email, kind, subject, body } = {}, context = {}) {
    if (!context.approvedTaskId) throw new Error('clienttracker.sendApproved runs only from an approved task.');
    if (!context.workspaceId) throw new Error('clienttracker.sendApproved needs a workspace.');
    return clientTracker.sendApproved(context.workspaceId, { email, kind, subject, body });
  },
};
