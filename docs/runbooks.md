# Runbooks

Step-by-step procedures for the operations an admin actually performs. Every
runbook is written so you can follow it the first time without needing to
read the architecture.

---

## Backing up the database

Takes ~1–2 minutes depending on your row counts. Writes a date-stamped folder
under `backups/` (which is gitignored).

```bash
cd backend
node scripts/backup-db.js --label pre-whatever-change
```

- Reads `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from `.env`.
- Paginates every table in the hard-coded `TABLES` list in 1000-row pages.
- Writes one JSON per table + a `_manifest.json` under
  `backups/<YYYY-MM-DD-<label>>/`.
- Writes a copy under `backend/backups/` as well (`backups/` and
  `backend/backups/` are both in `.gitignore`).

Afterwards, confirm the folder exists and look at `_manifest.json`.

**Keep backups out of git.** The folder is already gitignored, but double-
check `git status` doesn't show it.

---

## Running a migration safely

For `0001_workspaces_phase1.sql`:

1. Back up the database (previous runbook).
2. Open the file in a code editor; skim it so you understand what's about to
   happen.
3. Supabase → SQL Editor → paste the whole file → **Run**.
4. If the file hard-codes an admin email that isn't yours (around line 170
   — open the file to see the current value), edit it first.

For `0002_backfill_null_workspace.sql`:

1. Back up the database.
2. Open the file. Note that the backfill `DO $$ … $$;` block is **commented
   out on purpose**.
3. Paste only the two review queries at the top into the SQL Editor and
   run them. Confirm:
   - Exactly one workspace exists.
   - Per-table null counts match what you expect.
4. If the counts look right, go back to the file, **uncomment the backfill
   DO block only**, paste it into the SQL Editor, run.
5. Postgres will raise notices like `tasks: stamped 27 rows`. Capture the
   output.
6. Paste the verification block at the bottom (also commented out). Every
   count should be 0.
7. Only now set `WORKSPACE_GUARD_MODE=enforce` in Render. See
   [workspaces.md](workspaces.md).

**If anything looks wrong at step 3 or 6, stop.** You have the backup. Do not
run the backfill.

---

## Checking for and cleaning up test data

Test data in a production table usually comes from a test accidentally run
against the real DB (an outdated `.env`, a missing `CC_FORCE_MEMORY_STORE=1`).

1. Open `backend/scripts/find-test-rows.sql`.
2. Paste its queries into the Supabase SQL Editor.
3. The script lists rows whose instruction, name, or agent key matches
   common test patterns (`'test task 1'`, `'analytics-t1'`, etc.).
4. **Review the list before deleting anything.**
5. If you confirm each row is test cruft, delete explicitly, one query at a
   time. Never run a blanket DELETE.

The current test runner (post-Phase 2) forces `CC_FORCE_MEMORY_STORE=1`, so
this should rarely come up on new installs.

---

## Flipping the workspace guard on or off

**No code deploy required.**

To enforce:

1. Render → the backend service → Environment → set `WORKSPACE_GUARD_MODE=enforce`.
2. Save. Render restarts the service.
3. Open Settings → Workspace health. The panel should be empty (apart from
   allowlisted scheduler-tick entries from `scope:'system'` reads).
4. Click around the app, trigger a chat, approve a task — nothing should
   throw a `WorkspaceGuardError` in the UI toast.

To roll back to log mode:

1. Render → Environment → set `WORKSPACE_GUARD_MODE=log` (or delete the var).
2. Save. The service restarts and resumes shadow-only mode.

Prerequisite before enforcing: migration 0002's backfill has been run and
the verification block shows 0 null-workspace rows per table.

---

## Rolling back a bad deploy

Render:

1. Render → the backend service → **Events** tab.
2. Find the previous "Deploy succeeded" entry.
3. Click **Rollback**.
4. Confirm. Render redeploys that older commit.

Or via git (preferred if the bad commit is already on `main`):

1. `git revert <bad-commit-sha>`
2. `git push origin main`
3. Render auto-deploys the revert.
4. Confirm on **Events** that the new commit SHA is live.

**Do not force-push to `main`.** A revert commit is honest and traceable; a
force-push loses history.

Vercel: same **Events** tab → Rollback → confirm.

---

## Rotating a leaked key or password

For a **Supabase service_role key**:

1. Supabase → Project settings → API → **Reveal** the current service key
   (you need the old one to compare).
2. Rotate: click **Reset service key**. Copy the new one.
3. Render → Environment → paste into `SUPABASE_SERVICE_KEY`. Save.
4. Confirm the backend is still reachable (`GET /health`), that `/api/me`
   returns your user, and that a chat message to Ian returns a reply.
5. Revoke any copies of the old key you had locally (`.env` on your laptop
   — overwrite it).

For a **Composio reconnect** (Gmail / Calendar / Reddit / GitHub):

1. Composio dashboard → the connected account → **Disconnect**.
2. **Connect** again, complete OAuth.
3. Copy the new Connected Account id into the matching
   `COMPOSIO_<APP>_CONNECTED_ACCOUNT_ID` env on Render.
4. Confirm via `GET /api/composio/<app>/status`.

For an **admin password**:

1. Supabase → Authentication → Users → the admin row → **Send password
   recovery**.
2. The admin clicks the email link, chooses a new password.
3. (Or, if the admin is locked out: Edit user → **Set password** manually.)

For a **browser-extension token**:

1. Pick a new long random string.
2. Set `BROWSER_EXTENSION_TOKEN` on Render.
3. Update the extension's settings on each developer machine.
4. Old token stops working immediately on the backend restart.

For a **WhatsApp Meta token** or **Twilio token**:

Rotate in the respective dashboard (Meta → App → Settings → Reset,
or Twilio → API Keys & Tokens → Change). Paste the new value into Render
Environment.

---

## Scheduler health

Confirm the scheduler is actually ticking:

1. Render → **Logs** tab.
2. Look for `[scheduler] started - checking workflows every minute` on
   startup.
3. Every workflow run logs `[scheduler] running workflow "<name>"`. If none
   appear for ≥65 seconds and you have due workflows, the scheduler isn't
   running.

If the Render free tier is sleeping the service, see
[deployment.md § Render free plan](deployment.md#5-render-free-plan--the-sleeping-problem).

---

## Clearing the Workspace health shadow log

1. Settings → Workspace health → **Clear log**, or
2. `curl -X POST -H "Authorization: Bearer <admin JWT>" https://<backend>/api/workspace/shadow-log/clear`

Use after you've applied a fix for a reported miss so you can start fresh
and confirm no new misses appear.
