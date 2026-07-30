const config = require('../../config');
const FileTokenStore = require('./FileTokenStore');
const SupabaseTokenStore = require('./SupabaseTokenStore');

let instance;

function getTokenStore() {
  if (instance) return instance;

  if (config.supabase.url && config.supabase.serviceKey) {
    instance = new SupabaseTokenStore(config.supabase);
  } else {
    instance = new FileTokenStore();
  }

  return instance;
}

module.exports = getTokenStore();
