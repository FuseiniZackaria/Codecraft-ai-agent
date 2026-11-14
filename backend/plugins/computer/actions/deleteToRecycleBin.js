const target = require('../../../core/computerOperator/target');
const activityLog = require('../../../core/activityLog');

module.exports = {
  name: 'deleteToRecycleBin',
  permission: 'computer.delete',
  // The FIRST irreversible-tier action in the whole computer-operator
  // system - unlike Stages 1-7 (all read-only or a pure app hand-off),
  // this genuinely changes something on disk. Goes through the exact same
  // approval gate as sending an email - created via createApprovalTask in
  // the agent, never executed directly from plan().
  irreversible: true,

  /**
   * @param {object} args
   * @param {string[]} args.paths - specific, already-resolved file/folder paths to recycle (not names to search for)
   * @param {string} [args.deviceId] - the person's computer this was planned on (Computer Helper)
   * @param {string} [args.forUserId] - that person; only they can approve it
   */
  async run({ paths, deviceId, forUserId } = {}, context = {}) {
    const workspaceId = context.workspaceId || null;
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('deleteToRecycleBin requires a non-empty "paths" array');
    }
    // A delete planned on someone's computer runs ONLY there (never falls back
    // to this server); the size cap and Recycle-Bin-only rule are in ops.js.
    const out = await target.call('deleteToRecycleBin', { paths }, deviceId ? { deviceId, forUserId } : {});
    for (const r of out.results || []) {
      if (r.status === 'recycled') await activityLog.record('Computer Operator Agent', 'file_recycled', r.path, { wasDirectory: !!r.wasDirectory, workspaceId });
      else await activityLog.record('Computer Operator Agent', 'file_recycle_failed', r.path, { error: r.error, workspaceId });
    }
    return out;
  },
};
