/**
 * ops.js - the computer actions, by name, in ONE place.
 *
 * Used in two places with the exact same code:
 *   - on the server, for the old "local" mode (the backend runs on your own PC
 *     with COMPUTER_ALLOWED_ROOTS set), and
 *   - inside the Computer Helper each person runs on their own PC (the helper
 *     bundles this file and the modules below; see helperBundle.js).
 *
 * Every action keeps the existing safety rules: folder allowlist
 * (pathSafety.js), never-open file types (openFile.js), app allowlist
 * (appLaunch.js), Recycle Bin only and a batch cap (recycleBin.js).
 */

const { getAllowedRoots } = require('./pathSafety');
const { searchFiles } = require('./fileSearch');
const { listDirectory, findDirectoriesByName } = require('./directoryInspect');
const { openFile } = require('./openFile');
const { openFolder } = require('./openFolder');
const { findLargeFiles } = require('./largeFileAnalysis');
const { findOldFiles } = require('./oldFileAnalysis');
const { findDuplicateFiles } = require('./duplicateDetection');
const { moveToRecycleBin } = require('./recycleBin');
const { getAllowedApps, findAppsByName, launchApp } = require('./appLaunch');
const config = require('../../config');

const limits = () => ({
  maxSearchResults: Number(config.computerOperator?.maxSearchResults) || 200,
  maxDeleteBatch: Number(config.computerOperator?.maxDeleteBatch) || 20,
});

const NO_FOLDERS = 'No folders are shared on this computer yet - add at least one folder before the AI can look at files.';

function needRoots() {
  if (getAllowedRoots().length === 0) throw new Error(NO_FOLDERS);
}

const OPS = {
  // What this computer shares (no file contents) - shown on the "My computer" page.
  status: () => ({ roots: getAllowedRoots(), apps: Object.keys(getAllowedApps()) }),

  searchFiles: ({ query, root, extensions, caseSensitive, maxResults } = {}) => {
    needRoots();
    return searchFiles({
      query,
      roots: root ? [root] : undefined,
      extensions: Array.isArray(extensions) ? extensions : [],
      caseSensitive: !!caseSensitive,
      maxResults: Math.min(Number(maxResults) || limits().maxSearchResults, limits().maxSearchResults),
    });
  },

  findDirectoriesByName: ({ name } = {}) => {
    needRoots();
    return findDirectoriesByName(name);
  },

  listDirectory: ({ dirPath } = {}) => {
    needRoots();
    return listDirectory(dirPath, { maxResults: limits().maxSearchResults });
  },

  openFile: ({ filePath } = {}) => {
    needRoots();
    return openFile(filePath);
  },

  openFolder: ({ dirPath } = {}) => {
    needRoots();
    return openFolder(dirPath);
  },

  findLargeFiles: ({ minSizeMB, maxResults } = {}) => {
    needRoots();
    const minSizeBytes = Number(minSizeMB) > 0 ? Number(minSizeMB) * 1024 * 1024 : 0;
    return findLargeFiles({ minSizeBytes, maxResults: Number(maxResults) || 20 });
  },

  findOldFiles: ({ minAgeDays, maxResults } = {}) => {
    needRoots();
    return findOldFiles({ minAgeDays: Number(minAgeDays) || 0, maxResults: Number(maxResults) || 20 });
  },

  findDuplicateFiles: ({ maxResults } = {}) => {
    needRoots();
    return findDuplicateFiles({ maxResults: Number(maxResults) || 20 });
  },

  findAppsByName: ({ name } = {}) => findAppsByName(name),

  launchApp: ({ exePath } = {}) => {
    // Only a value that is in the app allowlist may launch - checked again here
    // so a job can never name an arbitrary program.
    const allowed = Object.values(getAllowedApps());
    if (!allowed.includes(exePath)) throw new Error('That app is not in the list of apps this computer allows.');
    return launchApp(exePath);
  },

  // Irreversible: only ever reached after a human approved it (Tasks page).
  deleteToRecycleBin: async ({ paths } = {}) => {
    needRoots();
    if (!Array.isArray(paths) || paths.length === 0) throw new Error('deleteToRecycleBin requires a non-empty "paths" array');
    const { maxDeleteBatch } = limits();
    if (paths.length > maxDeleteBatch) {
      throw new Error(`Refusing to delete ${paths.length} items in one action - the safety cap is ${maxDeleteBatch} per approval. Split this into smaller batches.`);
    }
    const results = [];
    for (const targetPath of paths) {
      try {
        const r = await moveToRecycleBin(targetPath);
        results.push({ path: targetPath, status: 'recycled', wasDirectory: !!r?.wasDirectory });
      } catch (err) {
        results.push({ path: targetPath, status: 'failed', error: err.message });
      }
    }
    return {
      results,
      succeeded: results.filter((r) => r.status === 'recycled').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
  },
};

const OP_NAMES = Object.keys(OPS);

async function runOp(op, args) {
  if (!Object.prototype.hasOwnProperty.call(OPS, op)) throw new Error(`Unknown computer action "${op}"`);
  return OPS[op](args || {});
}

module.exports = { runOp, OP_NAMES, NO_FOLDERS };
