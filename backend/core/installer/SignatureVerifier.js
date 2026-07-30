const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * SignatureVerifier - single responsibility: package integrity checks.
 *
 * Checksum verification is real (SHA-256 over every file in the package).
 * Digital signature verification is a real interface with NO backing
 * implementation - there's no certificate authority or key infrastructure
 * in this project. It's wired in so a real signing scheme can be added
 * later without changing the installer pipeline, but right now it always
 * returns `{ signed: false }` and callers treat that as "unverified, not
 * malicious" rather than blocking installation.
 */
class SignatureVerifier {
  computeChecksum(packageDir) {
    const hash = crypto.createHash('sha256');
    const files = this._listFilesSorted(packageDir);
    for (const file of files) {
      hash.update(path.relative(packageDir, file));
      hash.update(fs.readFileSync(file));
    }
    return hash.digest('hex');
  }

  verifyChecksum(packageDir, expectedChecksum) {
    if (!expectedChecksum) return { verified: null, reason: 'no checksum provided to compare against' };
    const actual = this.computeChecksum(packageDir);
    return { verified: actual === expectedChecksum, actual, expected: expectedChecksum };
  }

  /** NOT IMPLEMENTED - returns an honest "unsigned" result. */
  verifySignature() {
    return { signed: false, note: 'digital signature verification is not implemented yet' };
  }

  _listFilesSorted(dir) {
    const out = [];
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.push(full);
      }
    };
    walk(dir);
    return out;
  }
}

module.exports = { SignatureVerifier };
