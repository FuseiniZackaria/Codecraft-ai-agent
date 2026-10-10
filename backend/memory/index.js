const config = require('../config');
const MemoryStore = require('./MemoryStore');
const SupabaseStore = require('./SupabaseStore');
const { withWorkspaceGuard } = require('./workspaceGuard');

let instance;

function getMemory() {
  if (instance) return instance;

  let backing;
  // CC_FORCE_MEMORY_STORE is the kill switch set by scripts/run-tests.js so
  // `npm test` can NEVER touch the real database, even if someone later
  // adds a config path that reads SUPABASE_URL in a way the runner can't
  // zero out first. Belt-and-braces for the normal check below.
  const forceMemory = process.env.CC_FORCE_MEMORY_STORE === '1';
  if (forceMemory) {
    console.log('[memory] Using in-memory MemoryStore (CC_FORCE_MEMORY_STORE=1)');
    backing = new MemoryStore();
  } else if (config.supabase.url && config.supabase.serviceKey) {
    console.log('[memory] Using SupabaseStore (SUPABASE_URL configured)');
    backing = new SupabaseStore(config.supabase);
  } else {
    console.log('[memory] Using in-memory MemoryStore (no SUPABASE_URL configured)');
    backing = new MemoryStore();
  }

  // Phase 2.3: wrap the store with the workspace shadow guard. Zero behavior
  // change today - the wrapper only observes calls and appends to the local
  // shadow log file (backend/data/workspace_shadow.log). Phase 2.3b flips the
  // guard from "log on miss" to "throw on miss" once the shadow log confirms
  // every call site is passing workspaceId.
  instance = withWorkspaceGuard(backing);
  return instance;
}

module.exports = getMemory();
