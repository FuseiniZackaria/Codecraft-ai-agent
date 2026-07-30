const fs = require('fs');
const path = require('path');

const LOCAL_INDEX_PATH = path.join(__dirname, 'registry', 'index.json');
const SAMPLES_DIR = path.join(__dirname, 'registry', 'samples');

/**
 * Registry - interface to the CodeCraft Skill Registry.
 *
 * There is no hosted registry.codecraft.ai yet, so this reads a local JSON
 * index shipped with the app (with one real, working sample skill) instead
 * of pretending to hit a real network service. The interface is designed
 * so a real HTTP-backed registry can be dropped in later without callers
 * needing to change.
 */
class Registry {
  _loadIndex() {
    return JSON.parse(fs.readFileSync(LOCAL_INDEX_PATH, 'utf-8'));
  }

  search(query = '') {
    const index = this._loadIndex();
    const q = query.toLowerCase();
    if (!q) return index;
    return index.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    );
  }

  getDetails(id) {
    const entry = this._loadIndex().find((s) => s.id === id);
    if (!entry) throw new Error(`Skill "${id}" not found in registry`);
    return entry;
  }

  getLatestVersion(id) {
    return this.getDetails(id).version;
  }

  listCategories() {
    return [...new Set(this._loadIndex().map((s) => s.category))];
  }

  checkCompatibility(id, coreVersion) {
    const entry = this.getDetails(id);
    const min = entry.compatibility?.minimumCoreVersion || '0.0.0';
    return { compatible: compareSemver(coreVersion, min) >= 0, required: min, current: coreVersion };
  }

  resolveSource(id) {
    const entry = this.getDetails(id);
    return { type: 'local', path: path.join(SAMPLES_DIR, entry.samplePath) };
  }
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

module.exports = { Registry, compareSemver };
