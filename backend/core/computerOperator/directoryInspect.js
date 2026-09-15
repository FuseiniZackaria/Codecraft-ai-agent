const fs = require('fs');
const path = require('path');
const { isPathAllowed, isExcludedDirName, getAllowedRoots } = require('./pathSafety');

/**
 * directoryInspect.js - Stage 2: directory inspection.
 *
 * Two capabilities:
 *   1. listDirectory - list the IMMEDIATE contents of one specific folder
 *      (not recursive - "what's in this folder", not "everything under it").
 *   2. findDirectoriesByName - resolves a natural-language folder name
 *      (e.g. "downloads") to actual real path(s) within the allowed roots,
 *      since a user asking "what's in my downloads folder" gives a NAME,
 *      not a full path. Never invents a path that doesn't genuinely exist -
 *      returns real matches or none, with the caller (the agent) deciding
 *      how to handle zero/one/many results.
 */

/**
 * Lists the immediate children of dirPath - one level deep, files and
 * subfolders both. dirPath must be inside an allowed root or the call is
 * refused, same enforcement as fileSearch.js.
 *
 * @param {string} dirPath
 * @param {object} [options]
 * @param {number} [options.maxResults]
 * @returns {{ path: string, entries: Array<{name, path, isDirectory, sizeBytes, modifiedAt}>, truncated: boolean }}
 */
function listDirectory(dirPath, { maxResults = 200 } = {}) {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new Error('listDirectory requires a "dirPath"');
  }
  if (!isPathAllowed(dirPath)) {
    const roots = getAllowedRoots();
    throw new Error(
      roots.length === 0
        ? 'Computer access is not configured yet - no allowed folders are set.'
        : `"${dirPath}" is outside the allowed folders (${roots.join(', ')}) - refusing to list it.`
    );
  }

  let dirEntries;
  try {
    dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Could not read "${dirPath}": ${err.code || err.message}`);
  }

  const entries = [];
  let truncated = false;

  for (const entry of dirEntries) {
    if (entries.length >= maxResults) {
      truncated = true;
      break;
    }
    const fullPath = path.join(dirPath, entry.name);
    const isDirectory = entry.isDirectory();

    if (isDirectory && isExcludedDirName(entry.name)) continue;
    if (!isDirectory && !entry.isFile()) continue; // skip symlinks/sockets/etc.

    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue; // permission-denied on an individual entry - skip it, don't fail the whole listing
    }

    entries.push({
      name: entry.name,
      path: fullPath,
      isDirectory,
      sizeBytes: isDirectory ? null : stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }

  return { path: dirPath, entries, truncated };
}

/**
 * Resolves a folder NAME (not a path) to real candidate paths within the
 * allowed roots. Checks two things, in order:
 *   1. Does the name match an allowed root's own base folder name directly?
 *      (e.g. name="Downloads" and one allowed root literally IS
 *      "C:\Users\Dell\Downloads") - the common, fast case.
 *   2. Otherwise, search one level of subfolders within each allowed root
 *      for a directory name match (case-insensitive substring).
 * Never searches infinitely deep for a name match - that would be slow and
 * surprising; a user meaning a deeply nested folder should give more of
 * the path.
 *
 * @param {string} name
 * @returns {string[]} real, existing directory paths that matched
 */
function findDirectoriesByName(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('findDirectoriesByName requires a non-empty "name"');
  }
  const target = name.trim().toLowerCase();
  const roots = getAllowedRoots();
  const matches = [];

  for (const root of roots) {
    if (path.basename(root).toLowerCase() === target) {
      matches.push(root);
      continue; // an exact root match is definitive for this root - no need to also check its own subfolders for the same name
    }

    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue; // root itself unreadable - skip, don't fail the whole resolution
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (isExcludedDirName(entry.name)) continue;
      if (entry.name.toLowerCase().includes(target)) {
        matches.push(path.join(root, entry.name));
      }
    }
  }

  return matches;
}

module.exports = { listDirectory, findDirectoriesByName };