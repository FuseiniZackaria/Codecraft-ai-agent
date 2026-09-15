const fs = require('fs');
const path = require('path');
const { isPathAllowed, isExcludedDirName, getAllowedRoots } = require('./pathSafety');

/**
 * oldFileAnalysis.js - Stage 6: find the oldest (least recently modified)
 * files within the allowed folders. Read-only, non-destructive - same
 * safety tier as Stages 1 and 5 (no approval needed).
 *
 * "Old" here means "last modified a long time ago" - the only honest,
 * verifiable signal available from the filesystem. It deliberately does
 * NOT claim a file is "unused" or "safe to delete" - modification time
 * says nothing about whether something is still needed (an archive you
 * intentionally keep is exactly as "old" as true junk). That judgment is
 * left entirely to the user; this just surfaces real candidates with real
 * dates attached; nothing here recommends deletion.
 *
 * Separate walk implementation from fileSearch.js/largeFileAnalysis.js,
 * matching the pattern already established in Stage 5 - keeps the
 * already-tested, already-working modules untouched.
 */

/**
 * @param {object} params
 * @param {string[]} [params.roots] - defaults to ALL allowed roots
 * @param {number} [params.minAgeDays] - only include files last modified at least this many days ago; 0/omitted = no threshold, just rank everything oldest-first
 * @param {number} [params.maxResults]
 * @returns {{ results: Array<{path, name, sizeBytes, modifiedAt, ageDays}>, totalScanned: number, skippedFolders: string[] }}
 */
function findOldFiles({ roots, minAgeDays = 0, maxResults = 20 } = {}) {
  const now = Date.now();
  const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
  const allFiles = [];
  const skippedFolders = [];
  let totalScanned = 0;

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
      const ageMs = now - stat.mtime.getTime();

      if (ageMs < minAgeMs) continue;

      allFiles.push({
        path: fullPath,
        name: entry.name,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
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

  // Oldest first - largest ageDays / smallest modifiedAt timestamp first.
  allFiles.sort((a, b) => b.ageDays - a.ageDays);

  return {
    results: allFiles.slice(0, maxResults),
    totalScanned,
    skippedFolders,
  };
}

module.exports = { findOldFiles };