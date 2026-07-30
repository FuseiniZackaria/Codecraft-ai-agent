const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = ['id', 'name', 'version', 'entry'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/; // npm-style: lowercase, hyphens, no spaces

class ManifestError extends Error {}

/**
 * Manifest - loads and validates manifest.json for a skill package.
 * Single responsibility: shape/field validation only. Does not touch the
 * filesystem beyond reading the one file, does not check dependencies or
 * permissions against the running system (that's DependencyResolver /
 * PermissionManager's job).
 */
class Manifest {
  static load(packageDir) {
    const manifestPath = path.join(packageDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new ManifestError('manifest.json not found in package root');
    }

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      throw new ManifestError(`manifest.json is not valid JSON: ${err.message}`);
    }

    return Manifest.validate(raw);
  }

  static validate(raw) {
    const missing = REQUIRED_FIELDS.filter((f) => !raw[f]);
    if (missing.length) {
      throw new ManifestError(`manifest.json is missing required field(s): ${missing.join(', ')}`);
    }
    if (!ID_PATTERN.test(raw.id)) {
      throw new ManifestError(
        `Invalid skill id "${raw.id}" - must be lowercase letters, numbers, and hyphens only`
      );
    }
    if (!/^\d+\.\d+\.\d+/.test(raw.version)) {
      throw new ManifestError(`Invalid version "${raw.version}" - expected semver (e.g. "1.0.0")`);
    }

    return {
      id: raw.id,
      name: raw.name,
      version: raw.version,
      author: raw.author || 'unknown',
      description: raw.description || '',
      entry: raw.entry,
      minimumCoreVersion: raw.minimumCoreVersion || '0.0.0',
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
      permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
      tools: Array.isArray(raw.tools) ? raw.tools : [],
      events: Array.isArray(raw.events) ? raw.events : [],
    };
  }
}

module.exports = { Manifest, ManifestError };
