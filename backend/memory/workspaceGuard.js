/**
 * workspaceGuard - shadow-mode wrapper around the memory store.
 *
 * Phase 2.2 goal: no behavior change today, but every store call site that
 * SHOULD be scoped to a workspace can start declaring that scope. Call sites
 * that pass { workspaceId } let the guard verify the request matches the
 * row; call sites that don't are logged so we can see the coverage before
 * we flip to enforce in Phase 2.3.
 *
 * Shape:
 *   const guarded = withWorkspaceGuard(memory);
 *   await guarded.saveTask(task, { workspaceId });
 *   await guarded.listTasks({ workspaceId });
 *
 * Phase 2.3 will:
 *   - Make `workspaceId` required for every mutator and every list (throw
 *     if absent).
 *   - Auto-filter list results by workspace_id when the column exists.
 *
 * TODAY (shadow):
 *   - Every call without a workspaceId is appended to a local log file at
 *     backend/data/workspace_shadow.log (JSONL), one line per missed call.
 *   - Behavior is unchanged - the underlying store is called with its
 *     normal arguments and whatever it returns is passed back.
 *   - If workspace_id is set on a row and a workspaceId was supplied for
 *     the call, we log a mismatch (would-be cross-tenant write).
 *
 * The log is append-only, local to the server, and NEVER contains row
 * contents or secrets - just method name, timestamp, caller-supplied
 * workspaceId, and the row's workspaceId if present.
 */

const fs = require('fs');
const path = require('path');

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
        const OPT_KEYS = new Set(['workspaceId', 'system']);
        let callerWs = null;
        const last = args[args.length - 1];
        if (
          last &&
          typeof last === 'object' &&
          !Array.isArray(last) &&
          'workspaceId' in last &&
          Object.keys(last).every((k) => OPT_KEYS.has(k))
        ) {
          callerWs = last.workspaceId || null;
        }

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
          } else if (callerWs && rowWs && callerWs !== rowWs) {
            logMiss(prop, 'workspace_mismatch', { callerWs, rowWs });
          }
          // Shadow: do not block.
          return original.apply(target, args);
        }

        if (LIST_METHODS.has(prop)) {
          if (!callerWs) {
            logMiss(prop, 'list_without_workspace');
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
};
