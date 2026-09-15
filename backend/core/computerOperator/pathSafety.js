const path = require('path');
const config = require('../../config');

/**
 * pathSafety.js - the single security boundary every computer-operator
 * filesystem action must go through. This is deliberately the very first
 * thing built, before any actual search/read/open logic - every later
 * stage (directory inspection, opening files, eventually deletion) reuses
 * this same allowlist check rather than each inventing its own.
 *
 * Design principle: DEFAULT-DENY. Nothing outside an explicitly configured
 * root is ever touched, no exceptions, no "just this once." If
 * config.computerOperator.allowedRoots is empty/unset, NOTHING is
 * accessible - the user must explicitly opt a folder in before this agent
 * can see it at all.
 */

// Directories that are almost never useful to search/inspect and are
// either huge (slowing every search down) or contain noisy
// implementation-detail files - skipped by default even inside an allowed
// root. Never a security boundary by itself - allowedRoots is that - just
// a practical noise filter.
const DEFAULT_EXCLUDED_DIR_NAMES = [
  'node_modules', '.git', '.svn', '.hg',
  '$RECYCLE.BIN', 'System Volume Information',
  'AppData', 'ProgramData',
  '.cache', '.npm', '.vscode', '.idea',
];

function getAllowedRoots() {
  const roots = config.computerOperator?.allowedRoots || [];
  // Always resolved to absolute, normalized paths - a relative or
  // differently-cased path in config must never accidentally widen access.
  return roots.map((r) => path.resolve(r));
}

/**
 * True if targetPath is equal to, or nested inside, one of the configured
 * allowed roots. Uses a trailing-separator-aware comparison so
 * "C:\Users\Dell\Documents2" can never falsely match an allowed root of
 * "C:\Users\Dell\Documents" (a naive startsWith() would wrongly allow this).
 */
function isPathAllowed(targetPath) {
  const resolved = path.resolve(targetPath);
  const roots = getAllowedRoots();
  if (roots.length === 0) return false;

  return roots.some((root) => {
    if (resolved === root) return true;
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    return resolved.startsWith(rootWithSep);
  });
}

/**
 * Throws a clear error if the path is not allowed - the pattern every
 * action below uses, so a caller can't accidentally proceed past a denied
 * path by forgetting to check a boolean return value.
 */
function assertPathAllowed(targetPath) {
  if (!isPathAllowed(targetPath)) {
    const roots = getAllowedRoots();
    throw new Error(
      roots.length === 0
        ? `Computer access is not configured yet - no allowed folders are set. Add at least one folder to COMPUTER_ALLOWED_ROOTS in .env before this agent can access anything.`
        : `"${targetPath}" is outside the allowed folders (${roots.join(', ')}) - refusing to access it. Add it to COMPUTER_ALLOWED_ROOTS if this is somewhere you want the agent to reach.`
    );
  }
}

function isExcludedDirName(name) {
  return DEFAULT_EXCLUDED_DIR_NAMES.includes(name);
}

module.exports = {
  getAllowedRoots,
  isPathAllowed,
  assertPathAllowed,
  isExcludedDirName,
  DEFAULT_EXCLUDED_DIR_NAMES,
};