const fs = require('fs');
const path = require('path');
const { isPathAllowed, isExcludedDirName, getAllowedRoots } = require('./pathSafety');

/**
 * fileSearch.js - Stage 1: filesystem search.
 *
 * Recursively walks allowed folders looking for filename matches. Read-only,
 * non-destructive - no approval gate needed (matches this codebase's
 * existing pattern of only gating IRREVERSIBLE actions), but every path
 * touched is still checked against the allowlist in pathSafety.js before
 * being descended into.
 *
 * Deliberately resilient to real-world filesystem noise: a permission-
 * denied subfolder is skipped and recorded, not treated as a fatal error
 * that aborts the whole search - a real disk always has a few folders like
 * that, and one inaccessible folder shouldn't block finding everything
 * else.
 */

/**
 * @param {string} name - filename to test
 * @param {string} query - the search term
 * @param {object} [options]
 * @param {boolean} [options.caseSensitive]
 * @returns {boolean}
 */
function matchesQuery(name, query, { caseSensitive = false } = {}) {
  if (!query) return true;
  const a = caseSensitive ? name : name.toLowerCase();
  const b = caseSensitive ? query : query.toLowerCase();
  return a.includes(b);
}

/**
 * @param {object} params
 * @param {string} params.query - filename substring to search for
 * @param {string[]} [params.roots] - which allowed roots to search; defaults to ALL allowed roots
 * @param {string[]} [params.extensions] - restrict to these extensions (e.g. ['.pdf', '.docx']), case-insensitive, no leading dot required
 * @param {number} [params.maxResults]
 * @param {boolean} [params.caseSensitive]
 * @returns {{ results: Array<{path, name, sizeBytes, modifiedAt, isDirectory}>, skippedFolders: string[], truncated: boolean }}
 */
function searchFiles({ query, roots, extensions = [], maxResults = 200, caseSensitive = false }) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('searchFiles requires a non-empty "query"');
  }

  const normalizedExtensions = extensions.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`));
  const results = [];
  const skippedFolders = [];
  let truncated = false;

  function walk(dir) {
    if (truncated) return;
    // Re-check on every descent, not just at the entry point - defense in
    // depth in case a symlink or junction inside an allowed folder points
    // somewhere outside it.
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
      if (truncated) return;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (isExcludedDirName(entry.name)) continue;
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue; // skip symlinks/sockets/etc - only real files count

      if (normalizedExtensions.length > 0) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!normalizedExtensions.includes(ext)) continue;
      }

      if (!matchesQuery(entry.name, query, { caseSensitive })) continue;

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        skippedFolders.push(`${fullPath} (could not stat)`);
        continue;
      }

      results.push({
        path: fullPath,
        name: entry.name,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        isDirectory: false,
      });

      if (results.length >= maxResults) {
        truncated = true;
        return;
      }
    }
  }

  const searchRoots = roots && roots.length ? roots : getAllowedRoots();
  for (const root of searchRoots) {
    if (truncated) break;
    if (!isPathAllowed(root)) {
      skippedFolders.push(`${root} (outside allowed roots)`);
      continue;
    }
    walk(root);
  }

  return { results, skippedFolders, truncated };
}

module.exports = { searchFiles, matchesQuery };