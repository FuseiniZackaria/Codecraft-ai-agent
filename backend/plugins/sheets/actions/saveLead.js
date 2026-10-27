const googleSheets = require('../../../core/googleSheets');

module.exports = {
  name: 'saveLead',
  description: 'Save a sales lead to the Google Sheet. Call when a visitor gives contact details.',
  permission: 'sheets.write',
  // Internal record-keeping in the workspace's own sheet - nothing is sent to
  // the lead, so no approval gate.
  irreversible: false,

  // Second argument is the ToolRegistry call context; workspaceId picks the
  // workspace's own sheet (see core/googleSheets.js).
  async run({ name, email, phone, source, notes } = {}, context = {}) {
    return googleSheets.saveLead({ name, email, phone, source, notes }, { workspaceId: context.workspaceId || null });
  },
};
