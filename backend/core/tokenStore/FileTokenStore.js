const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', '.data', 'gmail-tokens.json');

/**
 * FileTokenStore - stores OAuth tokens in a local JSON file. Used when
 * Supabase isn't configured, so a dev environment still persists the Gmail
 * connection across server restarts.
 */
class FileTokenStore {
  async get(provider) {
    try {
      const all = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      return all[provider] || null;
    } catch {
      return null;
    }
  }

  async save(provider, tokens) {
    let all = {};
    try {
      all = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    } catch {
      // file doesn't exist yet
    }
    all[provider] = tokens;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  }
}

module.exports = FileTokenStore;
