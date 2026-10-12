# Changelog

Short bullets per date. See `git log` for the full history.

**2026-10-12**
- Phase 2.3d follow-up: close every post-backfill workspace-stamping leak
  across agent reflects, outreach pipeline, webhooks, workflow engine, and
  the API routes. New regression test asserts zero shadow-log misses.
- Documentation: README + 13 docs under `/docs/` + build script producing
  two PDFs. (Later shortened: pitch PDF to 6 pages, full to 30.)

**2026-10-11**
- Phase 2.3d: `WORKSPACE_GUARD_MODE=enforce` toggle; backfill SQL for
  null-workspace rows (ships commented out, run manually); two-account
  isolation test.

**2026-10-10**
- Phase 2.3d: explicit system scope + strict named-caller allowlist; fixed
  127 shadow-log entries; Clear-log button; "Add admin" disabled on UI
  and server until Phase 2.5.
- Safe-mode test runner (`npm test`) blanks every external credential and
  forces the in-memory store; `npm run test:integration` is the opt-in.
- Phase 2.3c: stamp and scope workflows / briefings / skills / facts;
  per-workspace scheduler iteration.
- Idle-request flood fix (session identity-stable; request caching; timers
  pause on hidden tab). Budget: ≤10 requests per 2 idle minutes.
- Fixed ConnectorPrompt polling 30-second interval; added Workspace health
  panel.

**2026-10-09**
- Phase 2.3b: stamp `audit_log`, `agent_memory`, `reflections`,
  `outreach_threads` with `workspace_id`.
- Phase 2.3: shadow guard attached to the memory store; `tasks` writes
  carry `workspace_id`.
- Phase 1 / 2.1 / 2.2 foundations: workspaces schema, nullable
  `workspace_id` on 14 existing tables, shadow RLS trigger; `req.user.workspaceId`
  resolution; Proxy wrapper around the store.
- Gmail guard + `outreach_threads` registry; honest "disconnected" state
  reporting for owner-notification channels.
- Vercel SPA 404 fix (hard refresh on `/tasks` no longer 404s).
- Team page + password visibility toggle + mobile layout polish.

**2026-10-08**
- Repo cleanup for Vercel deploy.
- Departments, floating assistant, Supabase auth, Job Application agent.

**2026-09-15**
- Computer Operator agent (allowlisted roots and apps; approval-gated
  Recycle-Bin delete).
- Briefing agent with memory across runs and `.docx` output; Intelligence
  dashboard aggregates `briefing_articles`.
- Opt-in per-workflow WhatsApp delivery of briefings.
- Chat markdown rendering; collapse toggle for long messages.

**Initial**
- Multi-agent orchestrator with approval gate; audit log; Supabase
  persistence; scheduled workflows checked every minute.
