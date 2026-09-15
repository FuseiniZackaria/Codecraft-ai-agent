const fs = require('fs');
const { isPathAllowed, getAllowedRoots } = require('./pathSafety');
const { launchWithDefaultApp } = require('./openFile');

/**
 * openFolder.js - Stage 4: open a folder in the OS's file explorer.
 *
 * Meaningfully SAFER than Stage 3's openFile - a folder can't execute
 * anything, opening it just shows its contents in Explorer/Finder/etc.
 * There's no extension-blocking concept here at all; the only check
 * needed is the standard path allowlist, same as every other stage.
 *
 * Reuses launchWithDefaultApp from openFile.js rather than duplicating the
 * OS-command logic - `start`/`open`/`xdg-open` work identically whether
 * the target is a file or a folder, so this is a single source of truth
 * for "hand this path to the OS's default handler."
 */

/**
 * @param {string} dirPath - must be an existing DIRECTORY inside an allowed root
 * @returns {Promise<{ status: string, path: string }>}
 */
async function openFolder(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new Error('openFolder requires a "dirPath"');
  }

  if (dirPath.includes('"')) {
    throw new Error('Folder paths containing a double-quote character are not supported.');
  }

  if (!isPathAllowed(dirPath)) {
    const roots = getAllowedRoots();
    throw new Error(
      roots.length === 0
        ? 'Computer access is not configured yet - no allowed folders are set.'
        : `"${dirPath}" is outside the allowed folders (${roots.join(', ')}) - refusing to open it.`
    );
  }

  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch (err) {
    throw new Error(`"${dirPath}" does not exist or could not be read: ${err.code || err.message}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`"${dirPath}" is not a folder - use openFile to open a specific file instead.`);
  }

  await module.exports.launchWithDefaultApp(dirPath);
  return { status: 'opened', path: dirPath };
}

module.exports = { openFolder, launchWithDefaultApp };