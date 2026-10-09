const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = config.supabase.url && config.supabase.serviceKey
  ? createClient(config.supabase.url, config.supabase.serviceKey)
  : null;

// --- Auth result cache (avoids a Supabase round-trip on every request) ---
const authCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;

function getCached(token) {
  const e = authCache.get(token);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) { authCache.delete(token); return null; }
  return e.user;
}
function setCache(token, user) {
  if (authCache.size >= CACHE_MAX) authCache.delete(authCache.keys().next().value);
  authCache.set(token, { user, at: Date.now() });
}

// Rate-limited error logging — one line per 30 s, not one per request.
let lastErrLog = 0;
function logAuthError(msg) {
  const now = Date.now();
  if (now - lastErrLog < 30_000) return;
  lastErrLog = now;
  console.warn(`[auth] ${msg}`);
}

async function requireAuth(req, res, next) {
  if (!supabase) {
    return res.status(500).json({ error: 'Auth is not configured on this server (missing SUPABASE_URL/SUPABASE_SERVICE_KEY)' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query.token || null);   // fallback for SSE (EventSource can't set headers)
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const cached = getCached(token);
  if (cached) {
    req.user = cached;
    return next();
  }

  let userData, userError;
  try {
    ({ data: userData, error: userError } = await supabase.auth.getUser(token));
  } catch (networkErr) {
    logAuthError(`Supabase unreachable: ${networkErr.message}`);
    return res.status(503).json({ error: "Can't reach the database. Check your internet connection." });
  }

  if (userError || !userData?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  let roleRows, roleError;
  try {
    ({ data: roleRows, error: roleError } = await supabase
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', userData.user.id));
  } catch (networkErr) {
    logAuthError(`Supabase unreachable (role lookup): ${networkErr.message}`);
    return res.status(503).json({ error: "Can't reach the database. Check your internet connection." });
  }

  if (roleError) {
    return res.status(500).json({ error: `Failed to look up role: ${roleError.message}` });
  }

  const roleNames = (roleRows || []).map((r) => r.roles?.name).filter(Boolean);
  const role = roleNames.includes('admin') ? 'admin' : 'client';
  let dashboardGoal = null;
  if (role === 'client') {
    try {
      const { data: accessRow } = await supabase
        .from('client_dashboard_access')
        .select('workflow_goal')
        .eq('user_id', userData.user.id)
        .maybeSingle();
      dashboardGoal = accessRow?.workflow_goal || null;
    } catch {
      // Non-fatal — proceed with null dashboardGoal
    }
  }

  const userObj = { id: userData.user.id, email: userData.user.email, role, dashboardGoal };
  setCache(token, userObj);
  req.user = userObj;

  // Phase 2.1: populate req.user.workspaceId from workspace_members. This
  // is deliberately NON-fatal - if the table isn't there (pre-migration)
  // or the user has no membership yet, workspaceId stays null and every
  // downstream caller behaves exactly as it did before Phase 2.
  try {
    const { resolveWorkspaceForUser } = require('./workspaceContext');
    const ws = await resolveWorkspaceForUser(userObj.id);
    req.user.workspaceId = ws.workspaceId;
    req.user.workspaceName = ws.workspaceName;
    req.user.workspaceRole = ws.role;
  } catch {
    // Already logged inside workspaceContext; never block the request on it.
  }

  next();
}
/** Restricts a route to a specific role (or roles). Use AFTER requireAuth. */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `This requires one of: ${allowedRoles.join(', ')}` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };