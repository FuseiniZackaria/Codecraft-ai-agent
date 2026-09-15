const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isPathAllowed, isExcludedDirName, getAllowedRoots } = require('./pathSafety');

/**
 * duplicateDetection.js - Stage 7: find files that are byte-for-byte
 * identical copies of each other within the allowed folders. Read-only,
 * non-destructive - same safety tier as every prior stage (no approval
 * needed, nothing is deleted or modified).
 *
 * Two-phase approach for efficiency on a real machine with thousands of
 * files:
 *   1. Group all files by SIZE first (cheap) - files of different sizes
 *      can never be duplicates, so this cheaply rules out almost
 *      everything without touching file contents at all.
 *   2. Only within a group that SHARES a size does this actually read and
 *      hash file contents (SHA-256) to confirm true byte-for-byte matches -
 *      same size alone is not proof of duplication.
 *
 * Like Stage 6, this makes no judgment about which copy to keep or whether
 * any of them are "safe to delete" - it only reports real, verified
 * duplicate sets with their real paths and dates; the decision is the
 * user's entirely.
 */

const DEFAULT_MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB - hashing larger files is costly for comparatively little benefit; skipped, not silently ignored (reported in skippedLargeFiles)

function hashFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * @param {object} params
 * @param {string[]} [params.roots] - defaults to ALL allowed roots
 * @param {number} [params.maxResults] - cap on how many duplicate GROUPS to return
 * @param {number} [params.maxFileSizeBytes] - files larger than this are skipped (not hashed), reported separately
 * @returns {{ duplicateGroups: Array<{sizeBytes, files: Array<{path,name,modifiedAt}>}>, totalGroupsFound: number, totalScanned: number, wastedBytes: number, skippedFolders: string[], skippedLargeFiles: string[] }}
 */
function findDuplicateFiles({ roots, maxResults = 20, maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES } = {}) {
  const bySizeCandidate = new Map();
  const skippedFolders = [];
  const skippedLargeFiles = [];
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
        continue;
      }

      totalScanned++;

      if (stat.size === 0) continue;
      if (stat.size > maxFileSizeBytes) {
        skippedLargeFiles.push(fullPath);
        continue;
      }

      if (!bySizeCandidate.has(stat.size)) bySizeCandidate.set(stat.size, []);
      bySizeCandidate.get(stat.size).push({ path: fullPath, name: entry.name, modifiedAt: stat.mtime.toISOString() });
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

  const duplicateGroups = [];
  let wastedBytes = 0;

  for (const [size, candidates] of bySizeCandidate.entries()) {
    if (candidates.length < 2) continue;

    const byHash = new Map();
    for (const file of candidates) {
      let hash;
      try {
        hash = hashFile(file.path);
      } catch {
        continue;
      }
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(file);
    }

    for (const group of byHash.values()) {
      if (group.length < 2) continue;
      duplicateGroups.push({ sizeBytes: size, files: group });
      wastedBytes += size * (group.length - 1);
    }
  }

  duplicateGroups.sort((a, b) => b.sizeBytes * (b.files.length - 1) - a.sizeBytes * (a.files.length - 1));

  return {
    duplicateGroups: duplicateGroups.slice(0, maxResults),
    totalGroupsFound: duplicateGroups.length,
    totalScanned,
    wastedBytes,
    skippedFolders,
    skippedLargeFiles,
  };
}

module.exports = { findDuplicateFiles, DEFAULT_MAX_FILE_SIZE_BYTES };
