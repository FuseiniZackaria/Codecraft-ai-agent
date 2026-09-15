const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { isPathAllowed, getAllowedRoots } = require('./pathSafety');

/**
 * openFile.js - Stage 3: open a file with its default application.
 *
 * This is meaningfully riskier than Stages 1-2 (which were purely
 * read-only metadata) - "opening" a file launches an external program, and
 * for certain file types that program IS the file itself (an .exe just
 * runs). The safety boundary here is deliberately a HARD BLOCK, not an
 * approval gate: if someone genuinely wants to run an executable or
 * script, they can double-click it themselves in Explorer - there's no
 * good reason for an AI agent to have that capability at all, so it isn't
 * offered as an option to approve, it's simply refused.
 *
 * Safe document/media/image file types open directly without an approval
 * step, same non-gated spirit as Stages 1-2 - this is equivalent to the
 * user themselves double-clicking a file they already have full access to,
 * not an action taken on anyone else's behalf.
 */

// Hard-blocked, not configurable, not an approval option - executables,
// scripts, installers, and other formats that RUN CODE rather than being
// passively viewed. Deliberately broad rather than narrow.
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.msi', '.msp', '.msc',
  '.ps1', '.ps1xml', '.psc1', '.psd1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta',
  '.jar', '.scr', '.pif', '.gadget', '.cpl', '.reg',
  '.sh', '.bash', '.app', '.apk', '.deb', '.rpm', '.dmg',
  '.dll', '.sys', '.drv',
];

function isBlockedExtension(filePath) {
  return BLOCKED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

/**
 * The actual OS-level launch, isolated into its own small function
 * deliberately so it can be stubbed out in tests - this sandbox has no
 * display/GUI to actually verify a real launch against, so the logic
 * ABOVE this function (path safety, extension blocking, existence checks)
 * is what gets thoroughly tested; this part needs real verification on an
 * actual Windows machine.
 *
 * Windows uses PowerShell's Start-Process rather than the classic
 * `start "" "path"` cmd trick - the latter has a well-documented quote-
 * nesting conflict between how Node's exec() invokes cmd.exe and how
 * cmd.exe itself parses a /c argument, which can silently swallow paths
 * containing spaces (reports success, launches nothing). Start-Process
 * handles spaced paths correctly and uses the same default-app file
 * association as double-clicking the file/folder in Explorer.
 */
function launchWithDefaultApp(filePath) {
  return new Promise((resolve, reject) => {
    let command;
    if (process.platform === 'win32') {
      // PowerShell single-quoted strings only need embedded single quotes
      // doubled - no other escaping required, and this avoids the cmd.exe
      // double-quote nesting problem entirely.
      const escaped = filePath.replace(/'/g, "''");
      command = `powershell -NoProfile -Command "Start-Process -FilePath '${escaped}'"`;
    } else if (process.platform === 'darwin') {
      command = `open "${filePath}"`;
    } else {
      command = `xdg-open "${filePath}"`;
    }
    exec(command, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * @param {string} filePath - must be an existing FILE inside an allowed root
 * @returns {Promise<{ status: string, path: string }>}
 */
async function openFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('openFile requires a "filePath"');
  }

  // Defense in depth against shell injection via a crafted filename -
  // launchWithDefaultApp interpolates this into a real shell command.
  if (filePath.includes('"')) {
    throw new Error('File paths containing a double-quote character are not supported.');
  }

  if (!isPathAllowed(filePath)) {
    const roots = getAllowedRoots();
    throw new Error(
      roots.length === 0
        ? 'Computer access is not configured yet - no allowed folders are set.'
        : `"${filePath}" is outside the allowed folders (${roots.join(', ')}) - refusing to open it.`
    );
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    throw new Error(`"${filePath}" does not exist or could not be read: ${err.code || err.message}`);
  }
  if (!stat.isFile()) {
    throw new Error(`"${filePath}" is not a file - use listDirectory to inspect a folder instead.`);
  }

  if (isBlockedExtension(filePath)) {
    throw new Error(
      `Refusing to open "${path.basename(filePath)}" - files of type "${path.extname(filePath)}" are executables/scripts and are never opened by this agent, ` +
      `no exceptions. If you genuinely want to run this, open it yourself directly.`
    );
  }

  await module.exports.launchWithDefaultApp(filePath);
  return { status: 'opened', path: filePath };
}

module.exports = { openFile, isBlockedExtension, launchWithDefaultApp, BLOCKED_EXTENSIONS };