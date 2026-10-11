/**
 * workspaceGuard - shadow-mode wrapper around the memory store.
 *
 * Call shapes:
 *   await guarded.saveTask(task, { workspaceId });              // user path
 *   await guarded.listTasks({ workspaceId });                   // user path
 *   await guarded.listWorkflows({ scope: 'system', systemCaller: 'scheduler-tick' });
 *
 * The guard distinguishes three cases:
 *   1. Scoped user call      -> workspaceId is set on the opts object OR on
 *                               the row being written. No log entry.
 *   2. Legitimate system op  -> opts.scope === 'system' AND opts.systemCaller
 *                               is in the ALLOWED_SYSTEM_CALLERS allowlist.
 *                               No log entry.
 *   3. Everything else       -> logged to backend/data/workspace_shadow.log
 *                               as a miss (or mismatch), with no behavior
 *                               change. Phase 2.3d flips the guard to throw.
 *
 * STRICT RULE: scope:'system' is for NAMED background callers only
 * (scheduler tick, plugin loader, startup, webhooks that have no user
 * context). API routes handling a user request MUST NOT use it - the
 * allowlist below enumerates the only acceptable callers. A novel caller
 * name is treated as a miss, not as an exemption, so a mistaken "mark
 * this as system" by a human is caught immediately.
 */

const fs = require('fs');
const path = require('path');

// Named system callers. ANYTHING not in this set is logged as a miss even
// when scope:'system' is passed. Keep the list short, grep-able, and
// obvious - adding a new caller is a deliberate PR-reviewable step.
const ALLOWED_SYSTEM_CALLERS = new Set([
  'scheduler-tick',             // core/scheduler.js tick() reads every workspace's workflows
  'scheduler-migrate',          // core/scheduler.js migrateLegacyGmailTriage()
  'plugin-loader',              // core/pluginLoader.js records plugin_loaded on startup
  'startup',                    // other one-time startup audit events
  'response-detection',         // agents/response-detection scheduler-triggered agent
  'outreach-pipeline',          // core/outreachPipeline scheduler-triggered checks
  'auto-reply-safety',          // webhook-triggered cross-workspace safety audit lookup
  'personal-assistant-system',  // PA scheduler-driven system scans (not user-triggered)
  'briefing-agent-system',      // BriefingAgent cross-workspace workflow listing
  'installer-startup',          // Installer dependency resolution during startup activation
  'workflow-engine-system',     // workflowEngine 'decide' node reads global recent activity
  'webhook-telegram',           // telegram inbound webhook, no user session
  'webhook-whatsapp',           // whatsapp inbound webhook, no user session
  'test',                       // test fixtures
]);

function isNamedSystemCall(opts) {
  if (!opts || opts.scope !== 'system') return false;
  return ALLOWED_SYSTEM_CALLERS.has(opts.systemCaller);
}

// Mode: 'log' (default) just appends misses to the shadow log; 'enforce'
// throws so unscoped user calls fail loudly with a clear error, while
// named system callers keep working. Switch via WORKSPACE_GUARD_MODE in
// .env - no code change needed to flip back to log mode on Render.
function currentMode() {
  const raw = (process.env.WORKSPACE_GUARD_MODE || 'log').toLowerCase().trim();
  return raw === 'enforce' ? 'enforce' : 'log';
}

class WorkspaceGuardError extends Error {
  constructor(reason, method, extras = {}) {
    super(
      `[workspace-guard:${reason}] ${method} refused in enforce mode - ` +
      `the call did not supply a workspace scope. Pass { workspaceId } (user ` +
      `path) or { scope: 'system', systemCaller: '<allowlisted-name>' } ` +
      `(background path). To temporarily switch back to log-only mode without ` +
      `redeploying code, set WORKSPACE_GUARD_MODE=log on the server.`
    );
    this.name = 'WorkspaceGuardError';
    this.code = reason;
    this.method = method;
    Object.assign(this, extras);
  }
}

const LOG_DIR = path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(LOG_DIR, 'workspace_shadow.log');

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Best-effort - if we can't create the dir we fall back to swallowing.
  }
}

function append(entry) {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`);
  } catch {
    // Shadow logging must never block or crash the store path.
  }
}

/**
 * Store methods that take a FIRST argument that is a row object. For these,
 * we check row.workspace_id against the caller's workspaceId.
 */
const ROW_WRITE_METHODS = new Set([
  'saveTask',
  'updateTask',
  'addChatMessage',
  'audit',
  'addReflection',
  'remember',
  'createOutreachThread',
  'updateOutreachThread',
  'saveWorkflow',
  'updateWorkflow',
  'saveWorkflowDefinition',
  'updateWorkflowDefinition',
  'saveWorkflowRun',
  'updateWorkflowRun',
  'saveBriefingRun',
  'saveBriefingArticles',
  'saveSkill',
  'updateSkill',
  'addFact',
  'upsertAssistantUsage',
]);

/**
 * Store methods that return lists. If a workspaceId is supplied for these,
 * Phase 2.3 will auto-filter. In shadow mode we just note "no scope".
 */
const LIST_METHODS = new Set([
  'listTasks',
  'listChatMessages',
  'listSkills',
  'listWorkflows',
  'listWorkflowDefinitions',
  'listOutreachThreads',
  'listOutreachThreadsByRecipient',
  'getAuditLog',
  'getFacts',
]);

const ALL_WATCHED = new Set([...ROW_WRITE_METHODS, ...LIST_METHODS]);

function logMiss(method, reason, extras = {}) {
  append({
    at: new Date().toISOString(),
    method,
    reason,
    ...extras,
  });
}

/**
 * Wraps a memory store. The wrapper is a Proxy so unlisted methods pass
 * through unchanged; this keeps the Phase 2.2 surface area small and
 * additive.
 *
 * Call shape:
 *   guarded.<method>(...args, { workspaceId })      // when callers opt in
 *   guarded.<method>(...args)                        // legacy; shadow-logged
 *
 * The last argument may be the workspace options object; we peel it off
 * before calling the underlying store so existing method signatures aren't
 * disturbed.
 */
function withWorkspaceGuard(store) {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== 'function' || !ALL_WATCHED.has(prop)) {
        return original;
      }
      return async function guarded(...args) {
        // Peek at the last argument WITHOUT popping it - the underlying
        // store methods receive their full argument list unchanged. The
        // guard only needs to read workspace options to classify the call;
        // store methods like addReflection themselves accept an options
        // argument and stamp workspace_id from it.
        const OPT_KEYS = new Set(['workspaceId', 'system', 'scope', 'systemCaller']);
        let callerWs = null;
        let callerOpts = null;
        const last = args[args.length - 1];
        if (
          last &&
          typeof last === 'object' &&
          !Array.isArray(last) &&
          ('workspaceId' in last || 'scope' in last) &&
          Object.keys(last).every((k) => OPT_KEYS.has(k))
        ) {
          callerWs = last.workspaceId || null;
          callerOpts = last;
        }

        // Named system calls (scheduler tick, plugin loader, webhooks, ...)
        // skip the miss check entirely. Must be in ALLOWED_SYSTEM_CALLERS -
        // an unrecognized name is still logged, so a stray "scope:'system'"
        // in a route handler can't masquerade as legitimate.
        if (isNamedSystemCall(callerOpts)) {
          return original.apply(target, args);
        }
        if (callerOpts && callerOpts.scope === 'system' && !ALLOWED_SYSTEM_CALLERS.has(callerOpts.systemCaller)) {
          // Visibly flag an attempted-but-not-allowlisted system scope so a
          // misuse is caught in the shadow log instead of silently passing
          // through as an ordinary workspace miss. In enforce mode this is
          // a hard refusal - a stray "scope:'system'" in a route handler
          // must never silently gain cross-workspace access.
          logMiss(prop, 'system_scope_but_caller_not_allowlisted', {
            attemptedSystemCaller: callerOpts.systemCaller || '(unset)',
          });
          if (currentMode() === 'enforce') {
            throw new WorkspaceGuardError('system_scope_but_caller_not_allowlisted', prop, {
              attemptedSystemCaller: callerOpts.systemCaller || '(unset)',
            });
          }
          return original.apply(target, args);
        }

        const enforce = currentMode() === 'enforce';

        if (ROW_WRITE_METHODS.has(prop)) {
          // Different store methods put the row at different arg positions
          // (saveTask -> args[0], remember -> args[1], audit -> args[3]).
          // Instead of per-method knowledge, scan every object argument for
          // a workspace_id / workspaceId stamp - any match counts as scoped.
          let rowWs = null;
          for (const a of args) {
            if (a && typeof a === 'object' && !Array.isArray(a)) {
              const ws = a.workspace_id || a.workspaceId;
              if (ws) { rowWs = ws; break; }
            }
          }
          if (!callerWs && !rowWs) {
            logMiss(prop, 'no_workspace_on_call_or_row');
            if (enforce) throw new WorkspaceGuardError('no_workspace_on_call_or_row', prop);
          } else if (callerWs && rowWs && callerWs !== rowWs) {
            logMiss(prop, 'workspace_mismatch', { callerWs, rowWs });
            if (enforce) throw new WorkspaceGuardError('workspace_mismatch', prop, { callerWs, rowWs });
          }
          return original.apply(target, args);
        }

        if (LIST_METHODS.has(prop)) {
          if (!callerWs) {
            logMiss(prop, 'list_without_workspace');
            if (enforce) throw new WorkspaceGuardError('list_without_workspace', prop);
          }
          return original.apply(target, args);
        }

        return original.apply(target, args);
      };
    },
  });
}

function readShadowLog(limit = 200) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
  } catch {
    return [];
  }
}

function clearShadowLog() {
  try { if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE); } catch { /* ignore */ }
}

module.exports = {
  withWorkspaceGuard,
  readShadowLog,
  clearShadowLog,
  LOG_FILE,
  ROW_WRITE_METHODS,
  LIST_METHODS,
  ALLOWED_SYSTEM_CALLERS,
  WorkspaceGuardError,
  currentMode,
};
