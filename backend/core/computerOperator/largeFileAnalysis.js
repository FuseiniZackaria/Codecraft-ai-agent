const fs = require('fs');
const path = require('path');
const { isPathAllowed, isExcludedDirName, getAllowedRoots } = require('./pathSafety');

/**
 * largeFileAnalysis.js - Stage 5: find the biggest files eating up disk
 * space within the allowed folders. Read-only, non-destructive - same
 * safety tier as Stage 1's search (no approval needed).
 *
 * Deliberately a SEPARATE walk implementation from fileSearch.js rather
 * than a shared refactor - fileSearch.js is already tested and working on
 * a real machine, and this keeps that untouched rather than risking a
 * regression in already-verified behavior for a stage that doesn't need it.
 * Both walks follow the same allowlist/exclusion rules, just for a
 * different purpose (name matching vs size ranking).
 */

/**
 * @param {object} params
 * @param {string[]} [params.roots] - defaults to ALL allowed roots
 * @param {number} [params.minSizeBytes] - only include files at or above this size; 0/omitted = no threshold, just rank everything
 * @param {number} [params.maxResults]
 * @returns {{ results: Array<{path, name, sizeBytes, modifiedAt}>, totalScanned: number, totalSizeBytes: number, skippedFolders: string[] }}
 */
function findLargeFiles({ roots, minSizeBytes = 0, maxResults = 20 } = {}) {
  const allFiles = [];
  const skippedFolders = [];
  let totalScanned = 0;
  let totalSizeBytes = 0;

  function walk(dir) {
    if (!isPathAllowed(dir)) {
      skippedFolders.push(`${dir} (outside allowed roots)`);
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      skippedFolders.push(`${dir} (${err.code || err.message})`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (isExcludedDirName(entry.name)) continue;
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        skippedFolders.push(`${fullPath} (could not stat)`);
        continue;
      }

      totalScanned++;
      totalSizeBytes += stat.size;

      if (stat.size < minSizeBytes) continue;

      allFiles.push({
        path: fullPath,
        name: entry.name,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }

  const searchRoots = roots && roots.length ? roots : getAllowedRoots();
  for (const root of searchRoots) {
    if (!isPathAllowed(root)) {
      skippedFolders.push(`${root} (outside allowed roots)`);
      continue;
    }
    walk(root);
  }

  allFiles.sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    results: allFiles.slice(0, maxResults),
    totalScanned,
    totalSizeBytes,
    skippedFolders,
  };
}

module.exports = { findLargeFiles };