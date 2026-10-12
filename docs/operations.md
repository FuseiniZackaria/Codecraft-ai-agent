# Operations

Day-to-day procedures first, then a problem → fix table.

---

## Procedures

### Backup the database

```bash
cd backend
node scripts/backup-db.js --label pre-whatever-change
```

Writes one JSON per table under `backups/<YYYY-MM-DD-<label>>/`. Both
`backups/` and `backend/backups/` are gitignored.

### Running a migration safely

For `0001_workspaces_phase1.sql`:

1. Back up the database.
2. Open the file; if the admin email hard-coded around line 170 isn't
   yours, edit it first.
3. Supabase → SQL Editor → paste → Run.

For `0002_backfill_null_workspace.sql`:

1. Back up the database.
2. Open the file. Note the backfill `DO $$ … $$;` block is **commented out
   on purpose**.
3. Paste only the two review queries at the top; confirm exactly one
   workspace exists and the per-table null counts look right.
4. Uncomment the backfill block, paste, run. Each table reports stamped
   rows via `RAISE NOTICE`.
5. Paste the verification block (also commented out); every count must be 0.
6. Only then set `WORKSPACE_GUARD_MODE=enforce` on Render.

If anything looks wrong at step 3 or 5, **stop** — you have the backup.

### Check for and clean up stray test data

1. Open `backend/scripts/find-test-rows.sql`.
2. Paste its queries into the SQL Editor.
3. The output lists rows matching common test patterns (`'test task 1'`,
   `'analytics-t1'`, etc.).
4. Review the list; delete explicit rows one query at a time. Never run a
   blanket DELETE.

### Flip the workspace guard

No code deploy required.

- **To enforce:** Render → Environment → `WORKSPACE_GUARD_MODE=enforce` →
  save (service restarts).
- **To roll back:** set it to `log` or delete it → save.

Prerequisites before enforcing: migration 0002 backfill run, verification
block all zeros, Workspace health panel empty aside from allowlisted
scheduler reads.

### Roll back a bad deploy

Render: Events tab → previous "Deploy succeeded" → **Rollback**.
Or via git: `git revert <bad-sha>` → `git push origin main` → Render
auto-deploys. **Do not force-push.** Same via the Vercel Events tab for the
frontend.

### Rotate a leaked key or password

| What leaked | How to rotate |
|---|---|
| Supabase service key | Supabase → Project settings → API → **Reset service key** → paste the new value into Render → Environment → `SUPABASE_SERVICE_KEY` → save |
| Composio connection | Composio dashboard → the connected account → Disconnect → Connect again → paste the new Connected Account id into the matching `COMPOSIO_<APP>_CONNECTED_ACCOUNT_ID` on Render |
| Admin password | Supabase → Authentication → Users → the admin row → **Send password recovery**; or Edit user → Set password manually |
| Browser extension token | Pick a new random string → `BROWSER_EXTENSION_TOKEN` on Render → update the extension's settings |
| WhatsApp / Twilio token | Rotate in the respective dashboard → paste into Render Environment |

### Scheduler health check

Render → Logs. On startup you should see
`[scheduler] started - checking workflows every minute`. Every workflow run
logs `[scheduler] running workflow "<name>"`. If no such line appears for
≥ 65 seconds and you have due workflows, the scheduler isn't ticking (likely
the free-tier service is asleep — see
[setup-and-deploy.md § The sleeping problem](setup-and-deploy.md)).

### Clear the Workspace health shadow log

Settings → Workspace health → **Clear log**. Equivalent to
`POST /api/workspace/shadow-log/clear`. Use after a fix so you can confirm
no new misses appear.

---

## Problem → fix

| Symptom | Fix |
|---|---|
| `fetch failed` / `ENOTFOUND` | DNS for Supabase failing: check `SUPABASE_URL`, Supabase project not paused, Render status |
| 401 Unauthorized | Session expired — sign out and in. If 401s persist, `SUPABASE_ANON_KEY` on backend doesn't match the frontend `VITE_SUPABASE_ANON_KEY` |
| 401 from the browser extension | `BROWSER_EXTENSION_TOKEN` differs between backend and extension |
| 404 on Vercel refresh | `frontend/vercel.json` missing from the build — it rewrites unknown paths to `index.html` |
| 429 "too many requests" | A rate limiter fired. Likely a client-side loop re-fetching — open DevTools → Network and find the repeating request |
| Idle request count high | Expected ≤ 10/2 min idle. If much higher, open an issue with the request names (phase-2 fix should hold) |
| Supabase quota errors | Free tier: 500 MB DB, 2 GB egress. Upgrade or prune old `audit_log` / `briefing_articles` rows |
| Render sleeping | Free tier sleeps after 15 min; scheduler pauses while asleep. Paid tier, or external uptime ping every 10 min |
| Backend restarted mid-work | Scheduler resumes on next tick; approvals persist; in-flight tool call is dropped |
| Agent returning fewer results | Likely missing/exhausted API key: Tavily, OpenAI image, YouTube — check the relevant `/api/composio/*/status` or the backend logs |
| Blank approval card | Task `payload` empty — the agent crashed before writing it. Reject and reproduce the request; inspect `GET /api/tasks/:id` |
| `WorkspaceGuardError` thrown | Error code tells you what to fix (see table below). Immediate workaround: set `WORKSPACE_GUARD_MODE=log`, fix the code path, redeploy, flip back |
| LLM 429 / 402 | Rate limit or out of credit; top up the provider account. Daily spend cap configurable via `ASSISTANT_DAILY_USD_CAP` |
| Composio action refused | Composio dashboard — reconnect; update `COMPOSIO_<APP>_CONNECTED_ACCOUNT_ID` on Render |
| WhatsApp webhook silent | Meta: Developer dashboard → Webhooks must point at `https://<backend>/webhooks/whatsapp`. Twilio: Console → Messaging → WhatsApp Sandbox webhook must point at `https://<backend>/webhooks/whatsapp/twilio`. Confirm Render isn't asleep |
| Telegram webhook silent | Re-register via `https://api.telegram.org/bot<TOKEN>/setWebhook?url=…`; check `getWebhookInfo` for `last_error_message` |

### `WorkspaceGuardError` codes

| Code | Meaning | Fix |
|---|---|---|
| `no_workspace_on_call_or_row` | Write didn't carry scope and the row has no `workspace_id` | The route or agent forgot `{ workspaceId }`; or a legacy row needs backfilling |
| `list_without_workspace` | A list call had no scope | Pass `{ workspaceId: req.user.workspaceId }`; or `{ scope:'system', systemCaller:'…' }` for a background caller |
| `workspace_mismatch` | Call-opts workspace ≠ row workspace | Someone passed a workspace that doesn't match the row's actual workspace |
| `system_scope_but_caller_not_allowlisted` | `scope:'system'` passed but `systemCaller` isn't in the allowlist | Add to `ALLOWED_SYSTEM_CALLERS` in `backend/memory/workspaceGuard.js` only if the caller is genuinely a background op; otherwise pass a real workspace |
