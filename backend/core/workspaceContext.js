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

// Short-lived cache for the "which workspace owns this server right now"
// lookup used by webhook paths that don't carry an authenticated user
// (Twilio/Meta WhatsApp callback, Telegram bot callback, scheduler-side
// briefings/outreach). Refreshed every 5 minutes - long enough to spare the
// DB on bursts, short enough that a brand-new workspace reaches webhooks
// without a server restart.
let soleWorkspaceCache = null;
const SOLE_WORKSPACE_TTL_MS = 5 * 60 * 1000;

/**
 * Returns the sole workspace's id in a single-admin deployment, or null if
 * there isn't exactly one. Webhook / scheduler callers that have no user
 * identity use this to stamp rows onto the right workspace instead of
 * leaving them legacy-null. Once Phase 2.5 introduces per-admin
 * connections, each webhook URL will carry its own workspace token and
 * callers can switch to that instead; until then, "there is one admin,
 * stamp their workspace" is the right default.
 */
async function getSoleWorkspaceId() {
  if (!supabase) return null;
  if (soleWorkspaceCache && Date.now() - soleWorkspaceCache.at < SOLE_WORKSPACE_TTL_MS) {
    return soleWorkspaceCache.workspaceId;
  }
  try {
    const { data, error } = await supabase
      .from('workspaces')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(2);
    if (error) return null;
    const workspaceId = Array.isArray(data) && data.length === 1 ? data[0].id : null;
    soleWorkspaceCache = { workspaceId, at: Date.now() };
    return workspaceId;
  } catch {
    return null;
  }
}

function invalidateSoleWorkspace() {
  soleWorkspaceCache = null;
}

// "Which workspace belongs to the app owner" - used by core/composio.js to
// decide who may fall back to the server's legacy .env Composio account.
// Resolved by APP_OWNER_EMAIL / APPLICANT_EMAIL -> auth user -> the workspace
// that user owns. Fails closed (null) on any lookup problem.
let ownerWorkspaceCache = null;
const OWNER_WORKSPACE_TTL_MS = 10 * 60 * 1000;

async function getAppOwnerWorkspaceId() {
  if (!supabase) return null;
  if (ownerWorkspaceCache && Date.now() - ownerWorkspaceCache.at < OWNER_WORKSPACE_TTL_MS) {
    return ownerWorkspaceCache.workspaceId;
  }
  const ownerEmail = (process.env.APP_OWNER_EMAIL || config.applicant?.email || '').toLowerCase();
  if (!ownerEmail) return null;
  try {
    const { data: userList, error: userErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (userErr) return null;
    const owner = (userList?.users || []).find((u) => u.email?.toLowerCase() === ownerEmail);
    if (!owner) return null;
    const { data, error } = await supabase
      .from('workspaces')
      .select('id')
      .eq('owner_user_id', owner.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const workspaceId = data?.id || null;
    ownerWorkspaceCache = { workspaceId, at: Date.now() };
    return workspaceId;
  } catch {
    return null;
  }
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

/**
 * Rows with no workspace_id are legacy single-tenant data (pre-workspaces
 * history, background jobs that couldn't resolve a workspace). They belong to
 * the app owner, so only the owner's workspace may see them - never any other
 * workspace. Fails closed: if the owner workspace can't be resolved, nobody
 * sees them.
 */
async function canSeeLegacy(workspaceId) {
  if (!workspaceId) return false;
  // Through module.exports so tests can stub the owner lookup.
  const ownerWs = await module.exports.getAppOwnerWorkspaceId();
  return !!ownerWs && ownerWs === workspaceId;
}

/** Is this row visible to the workspace? (legacyOk = await canSeeLegacy(ws)) */
function rowVisible(row, workspaceId, legacyOk) {
  if (!row || !workspaceId) return false;
  return row.workspace_id ? row.workspace_id === workspaceId : !!legacyOk;
}

module.exports = {
  canSeeLegacy,
  rowVisible,
  resolveWorkspaceForUser,
  attachWorkspace,
  invalidateUser,
  getSoleWorkspaceId,
  invalidateSoleWorkspace,
  getAppOwnerWorkspaceId,
};
