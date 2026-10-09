const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

/**
 * workspaceContext - resolves "which workspace is this request for?" from
 * the authenticated user. The result is stashed on req.user.workspaceId so
 * every downstream route/store call can filter on it.
 *
 * Phase 2.1 behavior (THIS FILE):
 *   - If workspace_members has a row for the user, use its workspace_id.
 *   - If workspace_members hasn't been created yet (pre-migration), return
 *     null and log once - the app keeps working, nothing changes.
 *   - If workspace_members exists but the user has no row, return null and
 *     log a one-time warning per user id.
 *
 * Phase 2.3 will tighten this to "no workspace -> 403". For now the goal is
 * zero behavior change; just populate the field.
 *
 * Caching: resolved workspaceId is cached per user for 5 minutes to avoid
 * hitting the DB on every request. The cache is invalidated by
 * invalidateUser(userId), called by any route that mutates membership.
 */

const supabase =
  config.supabase.url && config.supabase.serviceKey
    ? createClient(config.supabase.url, config.supabase.serviceKey)
    : null;

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // userId -> { workspaceId, workspaceName, role, at }

// Logged once per userId so an unmigrated DB doesn't produce one warning
// per request.
const warnedUsers = new Set();
let warnedMissingTable = false;

function cached(userId) {
  const e = cache.get(userId);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return e;
}

function putCache(userId, entry) {
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(userId, { ...entry, at: Date.now() });
}

function invalidateUser(userId) {
  if (userId) cache.delete(userId);
}

function isMissingTable(error) {
  if (!error) return false;
  if (error.code === '42P01') return true;
  const msg = String(error.message || '');
  return /does not exist/i.test(msg) || /could not find the table/i.test(msg);
}

/**
 * Returns { workspaceId, workspaceName, role } or an object with
 * workspaceId=null when the user has no workspace yet (which also happens
 * before the migration runs). Never throws for the pre-migration path.
 */
async function resolveWorkspaceForUser(userId) {
  if (!supabase || !userId) return { workspaceId: null, workspaceName: null, role: null };
  const hit = cached(userId);
  if (hit) return hit;

  let data;
  let error;
  try {
    ({ data, error } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces(name)')
      .eq('user_id', userId)
      .order('invited_at', { ascending: true })
      .limit(1)
      .maybeSingle());
  } catch (networkErr) {
    // Supabase retries can land here on transient network errors - don't
    // block the request; the next request will try again.
    return { workspaceId: null, workspaceName: null, role: null };
  }

  if (error) {
    if (isMissingTable(error)) {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn(
          '[workspaceContext] workspace_members table not found - migration ' +
            '0001_workspaces_phase1.sql has not been applied yet. ' +
            'Request will proceed without a workspaceId (legacy behavior).'
        );
      }
      const entry = { workspaceId: null, workspaceName: null, role: null };
      putCache(userId, entry);
      return entry;
    }
    // Any other error: don't cache, don't throw, log loudly once.
    if (!warnedUsers.has(userId)) {
      warnedUsers.add(userId);
      console.warn(`[workspaceContext] failed to resolve workspace for user ${userId}: ${error.message}`);
    }
    return { workspaceId: null, workspaceName: null, role: null };
  }

  if (!data) {
    if (!warnedUsers.has(userId)) {
      warnedUsers.add(userId);
      console.warn(`[workspaceContext] user ${userId} has no workspace_members row - request proceeds with workspaceId=null`);
    }
    const entry = { workspaceId: null, workspaceName: null, role: null };
    putCache(userId, entry);
    return entry;
  }

  const entry = {
    workspaceId: data.workspace_id,
    workspaceName: data.workspaces?.name || null,
    role: data.role || null,
  };
  putCache(userId, entry);
  return entry;
}

/**
 * Express middleware: run AFTER requireAuth. Populates req.user.workspaceId
 * from the cache + DB. Never fails the request - the next phase tightens.
 */
async function attachWorkspace(req, res, next) {
  if (req.user?.id) {
    const ws = await resolveWorkspaceForUser(req.user.id);
    req.user.workspaceId = ws.workspaceId;
    req.user.workspaceName = ws.workspaceName;
    req.user.workspaceRole = ws.role;
  }
  next();
}

module.exports = {
  resolveWorkspaceForUser,
  attachWorkspace,
  invalidateUser,
};
