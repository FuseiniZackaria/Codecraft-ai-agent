const fs = require('fs');
const path = require('path');
const { resolveProjectRoot, ensureProjectDir } = require('../plugins/filesystem/workspaceSafety');

/**
 * Which business (workspace) a generated project folder belongs to - so one
 * client can never list, open or download another client's files through
 * /api/workspace/<projectId>/...
 *
 * Agents stamp a project with claimProject() when they create it. The stamp
 * is a small hidden file inside the project folder (left out of file lists
 * and zips). Projects made before this existed have no stamp: only the app
 * owner's own workspace may open those.
 */

const MARKER = '.codecraft-owner.json';

function claimProject(projectId, workspaceId) {
  if (!projectId || !workspaceId) return;
  try {
    ensureProjectDir(projectId);
    const file = path.join(resolveProjectRoot(projectId), MARKER);
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ workspaceId, claimedAt: new Date().toISOString() }));
  } catch (err) {
    console.warn(`[projects] couldn't stamp ${projectId} with its business: ${err.message}`);
  }
}

function ownerOf(projectId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(resolveProjectRoot(projectId), MARKER), 'utf8')).workspaceId || null;
  } catch {
    return null;
  }
}

/** May this business open this project? */
async function canAccess(projectId, workspaceId) {
  if (!workspaceId) return false;
  const owner = ownerOf(projectId);
  if (owner) return owner === workspaceId;
  // Older, unstamped projects: the app owner's own workspace only.
  return require('./workspaceContext').canSeeLegacy(workspaceId).catch(() => false);
}

module.exports = { claimProject, ownerOf, canAccess, MARKER };
