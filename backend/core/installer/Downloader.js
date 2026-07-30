const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const AdmZip = require('adm-zip');

const STAGING_ROOT = path.join(os.tmpdir(), 'codecraft-installer');

function newStagingDir() {
  const dir = path.join(STAGING_ROOT, randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Downloader - single responsibility: given a source descriptor (from
 * SourceDetector), produce a local directory containing the unpacked
 * package. Everything downstream (Manifest, DependencyResolver, etc.)
 * only ever deals with a plain directory path.
 */
class Downloader {
  /** @param {{type: string, [key: string]: any}} source */
  async fetch(source) {
    switch (source.type) {
      case 'local':
        return this.fetchLocal(source.path);
      case 'zip-url':
        return this.fetchZipUrl(source.url);
      case 'github':
        return this.fetchGithub(source.repo);
      case 'registry':
        throw new Error(
          `Registry source "${source.id}" must be resolved to a concrete source first (see Registry.js)`
        );
      default:
        throw new Error(`Unsupported source type: ${source.type}`);
    }
  }

  fetchLocal(inputPath) {
    const resolved = path.resolve(inputPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Local path does not exist: ${resolved}`);
    }
    if (resolved.toLowerCase().endsWith('.zip')) {
      const buffer = fs.readFileSync(resolved);
      return this._extractZipBuffer(buffer);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`Local path is neither a directory nor a .zip file: ${resolved}`);
    }
    // Local directory installs aren't copied to staging - Installer copies
    // straight from here in a later stage, so we just hand back the real path.
    return resolved;
  }

  async fetchZipUrl(url) {
    const buffer = await downloadToBuffer(url);
    return this._extractZipBuffer(buffer);
  }

  async fetchGithub(repo) {
    // codeload.github.com serves tarball/zipball archives directly - no API
    // token needed for public repos. Try main, fall back to master.
    for (const branch of ['main', 'master']) {
      const url = `https://codeload.github.com/${repo}/zip/refs/heads/${branch}`;
      try {
        const buffer = await downloadToBuffer(url);
        const dir = this._extractZipBuffer(buffer);
        // GitHub zipballs wrap contents in a "<repo>-<branch>/" folder - unwrap it.
        return this._unwrapSingleSubdir(dir);
      } catch (err) {
        if (branch === 'master') throw new Error(`Could not download github:${repo} (tried main and master): ${err.message}`);
      }
    }
  }

  _extractZipBuffer(buffer) {
    const dir = newStagingDir();
    const zip = new AdmZip(buffer);
    zip.extractAllTo(dir, true);
    return dir;
  }

  _unwrapSingleSubdir(dir) {
    const entries = fs.readdirSync(dir);
    if (entries.length === 1 && fs.statSync(path.join(dir, entries[0])).isDirectory()) {
      return path.join(dir, entries[0]);
    }
    return dir;
  }
}

module.exports = { Downloader, newStagingDir };
