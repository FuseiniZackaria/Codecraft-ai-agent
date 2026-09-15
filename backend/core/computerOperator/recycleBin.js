const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { isPathAllowed, getAllowedRoots } = require('./pathSafety');

/**
 * recycleBin.js - Stage 8: move a file or folder to the Recycle Bin.
 *
 * This is the FIRST capability in the whole computer-operator system that
 * actually changes something on disk - everything before this (Stages 1-7)
 * was read-only or a pure hand-off to another app. Two deliberate,
 * non-negotiable safety properties:
 *
 *   1. RECYCLE BIN ONLY, NEVER PERMANENT DELETION. Moving something to the
 *      Recycle Bin is recoverable - the user gets a real chance to notice
 *      and undo a mistake. There is no "permanent delete" option anywhere
 *      in this module, on purpose.
 *   2. An ALLOWED ROOT ITSELF can never be deleted, even though it's
 *      technically inside "allowed" territory - deleting your own
 *      permission boundary is a uniquely bad failure mode, checked for
 *      explicitly, separate from the general allowlist check.
 *
 * The approval gate and per-batch cap live in the plugin action
 * (deleteToRecycleBin.js), not here - this module is just the safe,
 * single-target primitive.
 */

function isAllowedRootItself(targetPath) {
  const resolved = path.resolve(targetPath);
  return getAllowedRoots().some((root) => resolved === root);
}

/**
 * The actual OS-level recycle operation, isolated into its own small
 * function deliberately so it can be stubbed out in tests - this sandbox
 * has no real Windows Recycle Bin to verify against, so the logic ABOVE
 * this function (path safety, root protection, existence checks) is what
 * gets thoroughly tested; this part needs real verification on an actual
 * Windows machine, same as Stage 3's launchWithDefaultApp did (which
 * needed a real fix after real-world testing - expect the same possibility
 * here).
 *
 * Windows uses PowerShell's Microsoft.VisualBasic.FileIO.FileSystem class -
 * the standard, reliable way to send something to the REAL Recycle Bin
 * (not just delete it) from a script.
 */
function sendToRecycleBinOS(targetPath, isDirectory) {
  return new Promise((resolve, reject) => {
    let command;
    if (process.platform === 'win32') {
      const escaped = targetPath.replace(/'/g, "''");
      const method = isDirectory ? 'DeleteDirectory' : 'DeleteFile';
      command = `powershell -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')"`;
    } else if (process.platform === 'darwin') {
      const escaped = targetPath.replace(/"/g, '\\"');
      command = `osascript -e 'tell application "Finder" to delete POSIX file "${escaped}"'`;
    } else {
      const escaped = targetPath.replace(/"/g, '\\"');
      command = `gio trash "${escaped}"`;
    }
    exec(command, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * @param {string} targetPath - must exist, be inside an allowed root, and NOT be an allowed root itself
 * @returns {Promise<{ status: string, path: string, wasDirectory: boolean }>}
 */
async function moveToRecycleBin(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('moveToRecycleBin requires a "targetPath"');
  }

  if (targetPath.includes('"') || targetPath.includes("'")) {
    throw new Error('Paths containing a quote character are not supported.');
  }

  if (!isPathAllowed(targetPath)) {
    const roots = getAllowedRoots();
    throw new Error(
      roots.length === 0
        ? 'Computer access is not configured yet - no allowed folders are set.'
        : `"${targetPath}" is outside the allowed folders (${roots.join(', ')}) - refusing to delete it.`
    );
  }

  if (isAllowedRootItself(targetPath)) {
    throw new Error(
      `"${targetPath}" is itself one of your configured allowed folders (COMPUTER_ALLOWED_ROOTS) - refusing to delete an entire allowed root. Delete specific files/subfolders inside it instead.`
    );
  }

  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (err) {
    throw new Error(`"${targetPath}" does not exist or could not be read: ${err.code || err.message}`);
  }

  const isDirectory = stat.isDirectory();
  await module.exports.sendToRecycleBinOS(targetPath, isDirectory);
  return { status: 'recycled', path: targetPath, wasDirectory: isDirectory };
}

module.exports = { moveToRecycleBin, sendToRecycleBinOS, isAllowedRootItself };