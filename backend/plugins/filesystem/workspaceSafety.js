const path = require('path');
const fs = require('fs');

const WORKSPACE_ROOT = path.join(__dirname, '..', '..', 'workspace');
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

class UnsafePathError extends Error {}

/**
 * Resolves a project's root directory, validating the project id itself is
 * a safe slug (never trust an arbitrary caller-supplied id directly into a
 * path).
 */
function resolveProjectRoot(projectId) {
  if (!PROJECT_ID_PATTERN.test(projectId || '')) {
    throw new UnsafePathError(`Invalid project id "${projectId}" - must be a lowercase slug`);
  }
  return path.join(WORKSPACE_ROOT, projectId);
}

/**
 * Resolves a file path INSIDE a project's workspace and verifies - after
 * resolution, not before - that it's still actually inside that directory.
 * This is the real defense: checking the string for ".." is easy to get
 * wrong (encoded slashes, absolute paths, drive letters); checking the
 * fully-resolved path's prefix after path.resolve() is not.
 */
function resolveSafePath(projectId, relativePath) {
  const projectRoot = resolveProjectRoot(projectId);
  const resolved = path.resolve(projectRoot, relativePath);
  const normalizedRoot = projectRoot + path.sep;

  if (!resolved.startsWith(normalizedRoot) && resolved !== projectRoot) {
    throw new UnsafePathError(`Path "${relativePath}" escapes the project workspace - refused`);
  }
  return resolved;
}

function ensureProjectDir(projectId) {
  const projectRoot = resolveProjectRoot(projectId);
  fs.mkdirSync(projectRoot, { recursive: true });
  return projectRoot;
}

module.exports = { WORKSPACE_ROOT, resolveProjectRoot, resolveSafePath, ensureProjectDir, UnsafePathError, PROJECT_ID_PATTERN };
