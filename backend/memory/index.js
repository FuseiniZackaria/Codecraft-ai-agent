const config = require('../config');
const MemoryStore = require('./MemoryStore');
const SupabaseStore = require('./SupabaseStore');

let instance;

function getMemory() {
  if (instance) return instance;

  if (config.supabase.url && config.supabase.serviceKey) {
    console.log('[memory] Using SupabaseStore (SUPABASE_URL configured)');
    instance = new SupabaseStore(config.supabase);
  } else {
    console.log('[memory] Using in-memory MemoryStore (no SUPABASE_URL configured)');
    instance = new MemoryStore();
  }

  return instance;
}

module.exports = getMemory();
