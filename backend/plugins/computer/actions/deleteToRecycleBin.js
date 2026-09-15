const { moveToRecycleBin } = require('../../../core/computerOperator/recycleBin');
const { getAllowedRoots } = require('../../../core/computerOperator/pathSafety');
const config = require('../../../config');
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
   */
  async run({ paths } = {}) {
    const allowedRoots = getAllowedRoots();
    if (allowedRoots.length === 0) {
      throw new Error('No folders are configured for computer access yet. Set COMPUTER_ALLOWED_ROOTS in .env first.');
    }
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('deleteToRecycleBin requires a non-empty "paths" array');
    }

    const maxBatch = config.computerOperator.maxDeleteBatch;
    if (paths.length > maxBatch) {
      throw new Error(
        `Refusing to delete ${paths.length} items in one action - the safety cap is ${maxBatch} per approval. Split this into smaller batches.`
      );
    }

    const results = [];
    for (const targetPath of paths) {
      try {
        const result = await moveToRecycleBin(targetPath);
        results.push({ path: targetPath, status: 'recycled' });
        await activityLog.record('Computer Operator Agent', 'file_recycled', targetPath, { wasDirectory: result.wasDirectory });
      } catch (err) {
        results.push({ path: targetPath, status: 'failed', error: err.message });
        await activityLog.record('Computer Operator Agent', 'file_recycle_failed', targetPath, { error: err.message });
      }
    }

    const succeeded = results.filter((r) => r.status === 'recycled').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    return { results, succeeded, failed };
  },
};