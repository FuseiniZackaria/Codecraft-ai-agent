const express = require('express');
const cors = require('cors');
const config = require('./config');
const { loadPlugins } = require('./core/pluginLoader');
const routes = require('./api/routes');
const webhookRoutes = require('./api/webhookRoutes');
const eventsRoutes = require('./api/eventsRoutes');
const skillsRoutes = require('./api/skillsRoutes');
const workspaceRoutes = require('./api/workspaceRoutes');
const workflowsRoutes = require('./api/workflowsRoutes');
const workflowDefinitionsRoutes = require('./api/workflowDefinitionsRoutes');
const analyticsRoutes = require('./api/analyticsRoutes');
const browserRoutes = require('./api/browserRoutes');
const mcpRoutes = require('./api/mcpRoutes');
const teamRoutes = require('./api/teamRoutes');
const scheduler = require('./core/scheduler');
const briefingDashboardRoutes = require('./api/briefingDashboardRoutes');
const { requireAuth, requireRole } = require('./core/auth');
const { generalApiLimiter, goalSubmissionLimiter, webhookLimiter } = require('./core/rateLimits');

// Supabase's internal retry logic fires background promises that can reject
// after the outer try/catch in requireAuth has already returned. These show
// up as unhandled rejections with full stack traces — pure noise when the
// network is just down. Collapse them to a single short warning line.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  const isNetworkNoise =
    msg.includes('fetch failed') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNRESET') ||
    msg.includes('Connect Timeout') ||
    msg.includes('UND_ERR_CONNECT_TIMEOUT');
  if (isNetworkNoise) {
    console.warn(`[network] Supabase unreachable (${msg.split('\n')[0]}) — retrying on next request`);
    return;
  }
  // Real unhandled rejections still surface as-is
  console.error('[unhandledRejection]', reason);
});

const app = express();
// Trust the first proxy hop (Vercel/Railway/Render all sit behind one) so
// express-rate-limit reads the real client IP from X-Forwarded-For instead
// of the proxy's own IP - without this, every request looks like it comes
// from the same address and the limiter becomes meaningless.
app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, callback) => {
    // No origin = server-to-server call (curl, webhooks, etc.) - not a
    // browser request, so the CORS restriction doesn't apply. This never
    // weakens security for /webhooks, which is unauthenticated by design
    // anyway (see the comment on that route below).
    if (!origin) return callback(null, true);
    // The companion browser extension authenticates via its own
    // X-CodeCraft-Token header (config.browserExtension.token), not a
    // cookie/session - restricting it by origin here adds no real
    // security (a stolen token works regardless of origin) and breaks
    // legitimate extension requests.
    if (origin.startsWith('chrome-extension://')) return callback(null, true);
    if (config.cors.allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`Origin "${origin}" is not allowed by CORS`));
  },
  credentials: true,
}));app.use(express.json({ limit: '35mb' }));

// Dev-only: once per minute, print one line summarizing how many requests
// hit each route since the last tick, so the frontend's "flood check"
// story is observable from the server side too. Silent in production and
// cheap at idle (two integers per path).
if (process.env.NODE_ENV !== 'production') {
  const requestCounts = new Map(); // path -> count
  let totalInWindow = 0;
  app.use((req, _res, next) => {
    const path = req.path.split('?')[0];
    requestCounts.set(path, (requestCounts.get(path) || 0) + 1);
    totalInWindow += 1;
    next();
  });
  setInterval(() => {
    if (totalInWindow === 0) {
      console.log('[req/min] 0 requests in the last minute - idle');
    } else {
      const top = Array.from(requestCounts.entries()).sort((a, b) => b[1] - a[1]);
      const summary = top.map(([p, n]) => `${n}x ${p}`).join(', ');
      console.log(`[req/min] ${totalInWindow} total: ${summary}`);
    }
    requestCounts.clear();
    totalInWindow = 0;
  }, 60_000).unref();
}

const loadedPlugins = loadPlugins();
console.log(`[startup] Loaded plugins: ${loadedPlugins.join(', ') || '(none)'}`);

// /webhooks stays completely OPEN, deliberately - these are incoming calls
// from WhatsApp/Telegram/etc, which can't carry a logged-in user's token.
// Every other route below requires a valid session.
app.use('/webhooks',webhookLimiter , webhookRoutes);

// Public assistant config - name + speech-recognition variations. Zero
// secrets, needed before login (so the Login page can show "Ian" if ever
// branded there) and on every page refresh. No auth, no rate-limit noise.
app.get('/api/public-config', (req, res) => {
  res.json({
    assistantName: config.assistant.name,
    assistantNameVariations: config.assistant.nameVariations,
  });
});

app.use('/api/dashboard', requireAuth, requireRole('admin', 'client'), briefingDashboardRoutes);
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
    dashboardGoal: req.user.dashboardGoal,
    // Phase 2.1: expose current workspace. Null before the migration or for
    // users who aren't yet in a workspace - frontend treats null as legacy
    // behavior ("one shared workspace") until Phase 2.3 lands.
    workspaceId: req.user.workspaceId || null,
    workspaceName: req.user.workspaceName || null,
    workspaceRole: req.user.workspaceRole || null,
  });
});

// Dedicated workspace lookup. Same payload as the workspace block of /api/me,
// used by UI that specifically needs the current workspace (e.g. a top-bar
// workspace label). Deliberately a separate route so the admin layout can
// poll it without pulling the whole dashboard summary.
app.get('/api/workspace/me', requireAuth, (req, res) => {
  res.json({
    workspaceId: req.user.workspaceId || null,
    workspaceName: req.user.workspaceName || null,
    workspaceRole: req.user.workspaceRole || null,
  });
});

// Admin-only read of the workspace shadow log - lists store calls that are
// not yet passing a workspaceId or that attempted a cross-tenant write.
// Phase 2.3 observation window; Phase 2.3b flips the guard from "log" to
// "throw" once this endpoint is reporting zero or near-zero per minute.
app.get('/api/workspace/shadow-log', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { readShadowLog } = require('./memory/workspaceGuard');
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const entries = readShadowLog(limit);
    // Simple aggregation so the UI can show a scoreboard, not just a feed.
    const byMethodReason = {};
    for (const e of entries) {
      const key = `${e.method}:${e.reason}`;
      byMethodReason[key] = (byMethodReason[key] || 0) + 1;
    }
    res.json({ total: entries.length, limit, byMethodReason, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use('/api', requireAuth, requireRole('admin'), generalApiLimiter, routes);
app.use('/api/events', requireAuth, requireRole('admin'), eventsRoutes);
app.use('/api/skills', requireAuth, requireRole('admin'), skillsRoutes);
app.use('/api/workspace', requireAuth, requireRole('admin'), workspaceRoutes);
app.use('/api/workflows', requireAuth, requireRole('admin'), workflowsRoutes);
app.use('/api/workflow-definitions', requireAuth, requireRole('admin'), workflowDefinitionsRoutes);
app.use('/api/analytics', requireAuth, requireRole('admin'), analyticsRoutes);
// /api/browser stays OUTSIDE requireAuth, deliberately - it already has its
// own separate access control (config.browserExtension.token, checked via
// the X-CodeCraft-Token header inside browserRoutes itself), designed for
// the companion extension which can't produce a Supabase login session.
app.use('/api/browser', browserRoutes);
app.use('/api/mcp', requireAuth, requireRole('admin'), mcpRoutes);
app.use('/api/team', requireAuth, requireRole('admin'), teamRoutes);
app.get('/health', (req, res) => res.json({ status: 'ok', plugins: loadedPlugins }));

app.listen(config.port, () => {
  console.log(`CodeCraft AI backend running on http://localhost:${config.port}`);
  scheduler.start();
});

module.exports = app;
