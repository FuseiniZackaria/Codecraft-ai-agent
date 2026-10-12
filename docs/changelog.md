# Changelog

Grouped by date, drawn from git history. User-visible changes are called out
first; developer-only cleanups are at the bottom of each date.

---

## 2026-10-12

- **Phase 2.3d follow-up: close post-backfill workspace-stamping leaks.** After
  the Phase 2.3d backfill (yesterday), the Workspace health panel kept
  recording new misses on paths that still didn't carry workspace scope:
  agent `reflect()` overrides, the outreach pipeline, webhook agents, the
  workflow engine, and several API routes. Every one of them now stamps
  `workspace_id`. A new regression test (`workspace-shadow-leaks.test.js`)
  asserts zero misses across the previously-broken paths.

## 2026-10-11

- **Phase 2.3d: `WORKSPACE_GUARD_MODE=enforce` is now a supported env toggle.**
  Switchable on Render without a code redeploy. Enforce mode throws
  `WorkspaceGuardError` on any unscoped user call while named system callers
  keep working. Includes `0002_backfill_null_workspace.sql` for backfilling
  pre-Phase-2 null-workspace rows (manual run; file ships commented out on
  purpose). Two-account isolation test added to the suite.

## 2026-10-10

- **Phase 2.3d: fix the 127 shadow-log entries.** Scheduler ticks and plugin
  loading now use explicit `scope:'system'` with a strict named-caller
  allowlist, so legitimate background reads stop registering as misses.
  Real user-facing gaps (an admin page load that fired four unscoped reads)
  are fixed; `updateOutreachThread` now carries workspace. The Workspace
  health panel got a Clear-log button; "Add admin" is now disabled on the
  UI and server-side until Phase 2.5.
- **Safe-mode test runner (`npm test`).** Default test runner now blanks
  every external credential, forces the in-memory store and the mock
  provider, and refuses any real send (`sendGuard`). `npm run
  test:integration` is the opt-in that keeps real keys (but still blocks
  sends unless `ALLOW_REAL_SENDS=1`).
- **Force in-memory store for `npm test`.** Prevents test leakage into the
  real database even if `.env` has credentials.
- **Workspaces Phase 2.3c: workflows / briefings / skills / facts.** Stamp
  and scope `scheduled_workflows`, `workflow_definitions`, `workflow_runs`,
  `briefing_runs`, `briefing_articles`, `skills`, `long_term_memory`.
  Per-workspace scheduler iteration.
- **Idle-request flood fix.** Session identity-stability, request caching,
  pause timers on hidden tab. Idle budget now ≤ 10 requests per 2 minutes
  (was ~90).
- **ConnectorPrompt polling fix + Workspace health panel.** Stops a 30-second
  interval that was hitting `/api/browser/prompt` with 401s. Sign out on
  401 instead of looping. Settings → Workspace health panel added.

## 2026-10-09

- **Workspaces Phase 2.3b: stamp 4 more tables.** `audit_log`, `agent_memory`,
  `reflections`, `outreach_threads` now carry `workspace_id`.
- **Workspaces Phase 2.3: stamp writes.** Shadow guard attached to the memory
  store; `tasks` writes carry `workspace_id`.
- **Inbox-triage safety + lead provenance + Workspaces Phases 1/2.1/2.2.**
  The three Workspaces foundations: schema (one admin per workspace,
  nullable `workspace_id` on 14 existing tables, shadow RLS trigger),
  resolve `req.user.workspaceId` from `workspace_members` on login, shadow
  guard Proxy wraps the memory store.
- **Gmail guard + outreach_threads registry.** Every Gmail send now verifies
  it carries `approvedTaskId`, matches the stored recipient, isn't a
  duplicate within a 10-minute window. Owner-notification channels
  honestly report "disconnected" instead of mocking.
- **Vercel SPA 404 fix.** Hard refresh on `/tasks` or `/workflows` now
  returns the app, not a 404.
- **Team page + mobile layout polish.** Password visibility toggle on the
  login/reset forms.

## 2026-10-08

- **Clean up repo for Vercel deploy.** Backend/frontend separated cleanly;
  `vercel.json` added.
- **Departments + floating assistant + auth + Job Application agent.** The
  user-facing shape of the system that stuck: five departments on the
  dashboard, Ian in a floating chat window, Supabase auth, a Job
  Application agent that can pre-fill application forms behind the
  approval gate.

## 2026-09-15

- **Computer Operator agent, Briefing agent, Intelligence dashboard, WhatsApp
  delivery.** The Computer Operator agent gets a hard allowlist of roots
  and apps, a `deleteToRecycleBin` action gated by approval. The Briefing
  agent produces cited `.docx` reports and compares against the previous
  run for the same goal. The Intelligence dashboard aggregates
  `briefing_articles` into trend/freshness stats. Opt-in WhatsApp delivery
  per workflow.
- **Chat markdown rendering + collapse toggle.** Long messages collapse
  behind a "Show more".

## Initial

- Scaffold. Multi-agent orchestrator, approval gate, audit log, Supabase
  persistence, scheduled workflows checked every minute.

---

*Older entries are summarised in the git log — `git log --oneline` from the
repo root gives the full history.*
