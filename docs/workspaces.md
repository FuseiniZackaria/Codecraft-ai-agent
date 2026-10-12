# Workspaces (multi-tenancy)

How CodeCraft keeps each business's data separate from every other business's
on the same server.

---

## 1. What a workspace is

One workspace = one business. Every row in every meaningful table (`tasks`,
`chat_messages`, `audit_log`, `scheduled_workflows`, `workflow_definitions`,
`workflow_runs`, `briefing_runs`, `briefing_articles`, `agent_memory`,
`long_term_memory`, `reflections`, `outreach_threads`, `skills`,
`assistant_usage_daily`) carries a `workspace_id`.

Users attach to workspaces through the `workspace_members` table
`(workspace_id, user_id, role)`. On every authenticated request,
`workspaceContext.resolveWorkspaceForUser(userId)` looks up the oldest row
for the user and stamps `req.user.workspaceId`.

A single-admin deployment has exactly one workspace and one admin. A future
multi-admin deployment (Phase 2.5) will have multiple admins per workspace or
multiple workspaces on the same server.

---

## 2. Phases, with status

| Phase | Date | Scope | Status |
|---|---|---|---|
| **1** | Oct 9, 2026 | Add `workspaces`, `workspace_members`, `workspace_connections`, `business_profile`; add nullable `workspace_id` to 14 existing tables; backfill one workspace for the admin; shadow RLS trigger on all 14 altered tables | ✅ Shipped |
| **2.1** | Oct 9 | `attachWorkspace` middleware populates `req.user.workspaceId` after login | ✅ Shipped |
| **2.2** | Oct 9 | `workspaceGuard` Proxy wraps the memory store; shadow log of missing scopes | ✅ Shipped |
| **2.3** | Oct 9 | Stamp `workspace_id` on `tasks` writes | ✅ Shipped |
| **2.3b** | Oct 9 | Stamp `audit_log`, `agent_memory`, `reflections`, `outreach_threads` | ✅ Shipped |
| **2.3c** | Oct 10 | Stamp + scope `scheduled_workflows`, `workflow_definitions`, `workflow_runs`, `briefing_runs`, `briefing_articles`, `skills`, `long_term_memory`; per-workspace scheduler iteration | ✅ Shipped |
| **2.3d** | Oct 11 | `WORKSPACE_GUARD_MODE=enforce` env; null-workspace backfill SQL; two-account isolation test | ✅ Shipped |
| **2.3d follow-up** | Oct 12 | Close every post-backfill stamping leak (agent reflects, outreach pipeline, webhooks, workflow engine, routes) | ✅ Shipped |
| **2.4** | — | Business profile per workspace (name, logo, description, voice) | 🔜 Planned |
| **2.5** | — | Per-admin connection credentials (own Gmail, own Composio, own WhatsApp); re-enable "Add admin" | 🔜 Planned |
| **2.6** | — | Enable Postgres RLS on all 14 altered tables (shadow log retired) | 🔜 Planned |

---

## 3. The shadow guard

`backend/memory/workspaceGuard.js` wraps the active store (either
`MemoryStore` or `SupabaseStore`) in a `Proxy`. Every call to a watched method
is classified into one of three cases:

| Case | What happens |
|---|---|
| Scoped user call (`workspaceId` on opts, or `workspace_id` on the row object) | Passes through silently |
| Named system call (`scope:'system'` + `systemCaller` in the allowlist) | Passes through silently |
| Anything else | Shadow-logged (log mode) or thrown as `WorkspaceGuardError` (enforce mode) |

Logged entries live in `backend/data/workspace_shadow.log` (one JSON per line).
`readShadowLog(limit)` returns the last `limit`; `clearShadowLog()` unlinks the
file.

### Watched methods

**Row writes:** `saveTask`, `updateTask`, `addChatMessage`, `audit`,
`addReflection`, `remember`, `createOutreachThread`, `updateOutreachThread`,
`saveWorkflow`, `updateWorkflow`, `saveWorkflowDefinition`,
`updateWorkflowDefinition`, `saveWorkflowRun`, `updateWorkflowRun`,
`saveBriefingRun`, `saveBriefingArticles`, `saveSkill`, `updateSkill`,
`addFact`, `upsertAssistantUsage`.

**Lists:** `listTasks`, `listChatMessages`, `listSkills`, `listWorkflows`,
`listWorkflowDefinitions`, `listOutreachThreads`,
`listOutreachThreadsByRecipient`, `getAuditLog`, `getFacts`.

Everything else passes through the Proxy untouched.

---

## 4. The Workspace health panel

**Settings → Workspace health** (admin only). Reads
`GET /api/workspace/shadow-log`. Each row shows:

- `method` — which store method was called (e.g. `saveTask`)
- `reason` — one of:
  - `no_workspace_on_call_or_row` (write missing both call-opts and row stamp)
  - `list_without_workspace` (a list call with no scope)
  - `workspace_mismatch` (call-opts workspace differed from row workspace)
  - `system_scope_but_caller_not_allowlisted` (claimed scope:'system' but the
    `systemCaller` isn't in the allowlist)
- Extras — `callerWs`, `rowWs`, `attemptedSystemCaller`

In a healthy deployment the panel is **empty** or shows only expected
scheduler-tick entries from `scope:'system'` reads (the scheduler reads
every workspace's workflows on purpose — those are already allowlisted and
don't produce misses).

### Clear-log button

**POST /api/workspace/shadow-log/clear** wipes the file. Use after a fix so you
can start fresh and confirm no new misses appear.

---

## 5. The system-scope allowlist

Only these 14 names may legitimately bypass per-workspace scope:

```
scheduler-tick, scheduler-migrate, plugin-loader, startup,
response-detection, outreach-pipeline, auto-reply-safety,
personal-assistant-system, briefing-agent-system, installer-startup,
workflow-engine-system, webhook-telegram, webhook-whatsapp, test
```

A `scope: 'system'` call with any other `systemCaller` is **refused**
immediately (shadow-logged or thrown) — a mistaken "mark as system" by a
developer can't masquerade as legitimate background work.

The allowlist lives in `backend/memory/workspaceGuard.js`. Adding a new entry
is a deliberate code change that should go through code review.

---

## 6. `WORKSPACE_GUARD_MODE` toggle

| Value | Behaviour |
|---|---|
| `log` (default) | Misses are shadow-logged; the underlying store call still runs. |
| `enforce` | Misses throw `WorkspaceGuardError` — the underlying store call does **not** run. |

**Switchable without a code redeploy.** Set `WORKSPACE_GUARD_MODE=enforce` on
Render → Environment and the next request picks it up. Flip back to `log` the
same way if anything breaks.

### Enforce prerequisites

1. Migration 0002 backfill run successfully — no null-workspace rows remain.
2. Full safe-mode test suite passes (`npm test`).
3. The Workspace health panel is empty (apart from allowlisted scheduler
   entries).

If any of those is off, flip back to `log` immediately.

### Rolling back

- Set `WORKSPACE_GUARD_MODE=log` in Render → Environment → service restarts
  automatically.
- Fix the offending code path.
- Flip back to `enforce` once the panel is clean again.

---

## 7. Why "Add admin" stays disabled until Phase 2.5

The **Team** page's "Add admin" button is disabled with a banner:
> "Available once workspace isolation is enabled."

Server side, `POST /api/team` returns a `409` with the same message. Both the
UI and the server refuse admin creation.

Reason: until Phase 2.5 lands, every admin on the same server shares the same
Composio / Gmail / Twilio / Meta credentials. A second admin would gain full
access to the first admin's integrations — not just their workspace data. The
guard is correct, but the integration layer isn't workspace-scoped yet.

Phase 2.5 adds per-admin connected accounts (Composio hosted-connect flow,
own OAuth tokens per workspace). When that ships, both the UI and the server
409 go away.

---

## 8. Migration 0002 — null-workspace backfill

`backend/database/migrations/0002_backfill_null_workspace.sql`.

The file is **mostly commented out on purpose**. Running it as-is does nothing.
It contains:

1. Two review queries at the top (`workspaces` list, per-table null counts).
2. A commented-out `DO $$ … $$;` block that stamps every null-workspace row
   with the single workspace's id (refuses if more than one workspace exists).
3. A final verification query — every count should be 0.

Full procedure in [runbooks.md § Running a migration safely](runbooks.md).

**Do not flip `WORKSPACE_GUARD_MODE=enforce` before this is done.** Enforce
mode will throw on any legacy null-workspace list, breaking the UI.

---

## 9. Phase 1 shadow RLS trigger

Migration 0001 installed a Postgres trigger (`rls_shadow_log_fn`) on all 14
altered tables that logs any INSERT/UPDATE/DELETE whose row `workspace_id`
disagrees with the `app.workspace_id` session setting. This is separate from
the application-layer shadow guard and gives a defence-in-depth signal at the
database level. Nothing fails — rows go in, the trigger just records
disagreements. Retired once Phase 2.6 enables real RLS.
