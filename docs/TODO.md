# TODO: confirm

Open items the docs refer to. Each is a small cleanup, not a blocker.

- **Hardcoded admin email in `backend/database/migrations/0001_workspaces_phase1.sql`**
  on roughly line 170. If a new admin takes over, change that line before
  re-running the migration. Kept out of published docs so they don't name a
  specific person.
- **`scheduled_workflows` table vs `saveWorkflow` method names.** The SQL
  table is `scheduled_workflows`; the SupabaseStore methods are
  `saveWorkflow` / `listWorkflows` / etc. Intentional but worth renaming
  on a future cleanup for consistency.
- **`docx` listed as a dependency in the root `package.json`** (`^9.7.1`)
  and in `backend/package.json` (`^9.9.0`). Harmless duplicate.
- **`MANUAL_TASKS_EMAIL`** env variable: not read by the current code. The
  system-digest path reads `APPLICANT_EMAIL`. If a separate owner-notification
  address is wanted, add a new config entry.
- **`BROWSER_EXTENSION_TOKEN`** gates both `/api/browser/*` and `/api/mcp/*`.
  Two surfaces, one shared token — consider splitting on a future refactor.
- **Background jobs default to disabled.** `OUTREACH_RESPONSE_CHECK_INTERVAL_MINUTES`
  and `OUTREACH_FOLLOWUP_CHECK_INTERVAL_MINUTES` are both `0` by default.
- **A commented-out `FOO` reference** in `backend/config/index.js` is
  illustrative comment prose explaining why `dotenv.config()` is skipped in
  test mode. Not a real env var.
