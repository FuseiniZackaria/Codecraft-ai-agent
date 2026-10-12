# Troubleshooting

Plain-language fixes for the errors people actually see. If the fix for your
error isn't here, open an issue with the exact log line and what you were
doing when it appeared.

---

## `fetch failed` / `ENOTFOUND`

The backend can't reach Supabase (or another external service).

Checks, in order:

1. **DNS**: `ping <subdomain>.supabase.co` from the Render shell. If DNS
   itself fails, Supabase is unreachable or paused.
2. **Supabase pause**: free-tier projects pause after a week of inactivity.
   Visit the Supabase dashboard — the "resume" button appears if it's
   paused.
3. **Credentials**: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in Render match
   the Supabase project.
4. **Network outage**: Render status page.

While the backend is unreachable, the frontend shows "Can't reach the server"
with a growing retry backoff — that's expected; don't force-refresh in a loop.

---

## 401 Unauthorized

Your session expired or the JWT is missing.

- Sign out and sign in again.
- If 401s continue, the backend hasn't been able to validate the JWT —
  check `SUPABASE_ANON_KEY` on the backend matches the frontend's
  `VITE_SUPABASE_ANON_KEY` (both must point at the same Supabase project).
- A 401 inside the Browser extension means `BROWSER_EXTENSION_TOKEN` doesn't
  match on the two sides.

The frontend has a one-shot sign-out on 401, so you won't get a storm.

---

## 404 on refresh (Vercel SPA)

Already handled by `frontend/vercel.json` rewriting unknown paths to
`index.html`. If a deploy breaks this, re-check the file is present in
the Vercel build output.

---

## "Too many requests" (429)

A rate limiter kicked in. Current limiters:

- `generalApiLimiter` on `/api/*`
- `goalSubmissionLimiter` on `POST /api/orchestrator/goal`
- `teamMutationLimiter` on `POST /api/team` and `DELETE /api/team/:id`
- `webhookLimiter` on `/webhooks/*`

If you're seeing 429s during normal use, you probably have a client-side loop
re-fetching too fast. Open DevTools → Network and look for a request repeating.

---

## Idle request count check

The frontend used to flood the backend when idle (~90 requests over 2 minutes
from `onAuthStateChange` firing on tab focus). Phase 2 fixed this; the current
target is **≤10 requests per 2 idle minutes**.

To verify:

1. Open the frontend, log in, land on the Dashboard.
2. Open DevTools → Network → **Preserve log**.
3. Switch away from the tab for 2 minutes.
4. Switch back and count requests. If it's much higher than 10, open an
   issue with the request names.

---

## Supabase free-plan limits

Free tier:

- 500 MB database
- 2 GB egress / month
- Pauses after a week of inactivity

Signs you're hitting limits:

- Writes start failing with "quota exceeded" or similar.
- `/api/dashboard/briefing` takes seconds (egress throttling).

Fix: upgrade the plan, or prune old `audit_log` and `briefing_articles` rows.

---

## Render sleeping

Free Render services sleep after 15 minutes of no traffic and take ~30 s to
wake. Impact on CodeCraft:

- Scheduled workflows pause while asleep.
- The first request after a sleep takes 30 s.

Fix: paid tier, or an external ping (UptimeRobot every 10 minutes).

---

## Backend restarting mid-work

Scheduled workflows pick up again on the next tick. Pending approvals persist
in the `tasks` table. Chat history persists in `chat_messages`. No work is
lost. Any in-flight tool call is dropped — the agent's `activityLog` has the
last known state.

---

## Agent returning fewer results than expected

Likely a missing/exhausted API key:

- Web search quiet? `TAVILY_API_KEY` isn't set or you've hit your Tavily
  quota.
- Image generation returning nothing? `OPENAI_API_KEY` isn't set or over
  quota. The Content Studio agent silently degrades to text-only.
- YouTube search quiet? `YOUTUBE_API_KEY` isn't set or quota exhausted.

Check `/api/composio/*/status` for each service you've connected via
Composio. For direct-API services (Tavily, YouTube), the agent prints a
warning in logs when the key is missing.

---

## Blank approval card on the Tasks page

The task's `payload` is empty. Causes:

- The agent crashed before writing the payload.
- The task is from an older version of an agent whose payload shape changed.
- The payload is a format the Tasks UI doesn't know how to render yet.

Look at the raw task via `GET /api/tasks/:id`. If `payload` is `null`, the
agent crashed — reject the task and reproduce the request.

---

## `WorkspaceGuardError`

Thrown by the workspace guard in `enforce` mode. The error code tells you
what to fix:

| Code | Meaning | Likely fix |
|---|---|---|
| `no_workspace_on_call_or_row` | A write call didn't carry a workspace scope and the row has no `workspace_id` | The route or agent forgot to pass `{ workspaceId }`; or the task row was created before Phase 2 and isn't backfilled |
| `list_without_workspace` | A list call didn't carry a workspace scope | The route forgot `{ workspaceId: req.user.workspaceId }`; or a system caller forgot `{ scope:'system', systemCaller:'…' }` |
| `workspace_mismatch` | `{ workspaceId: X }` on the call-opts, but the row's `workspace_id` is Y | Someone passed a workspace from the request that doesn't match the row's actual workspace |
| `system_scope_but_caller_not_allowlisted` | A caller used `scope:'system'` but `systemCaller` isn't in the allowlist | Add the caller to `ALLOWED_SYSTEM_CALLERS` in `workspaceGuard.js` only if it's genuinely a background caller; otherwise pass a real workspace |

**Immediate workaround**: set `WORKSPACE_GUARD_MODE=log` on Render → service
restarts → the error becomes a shadow-log entry instead of a thrown error.
Fix the underlying call, redeploy, then flip back to `enforce`.

---

## API credit errors (Anthropic / OpenAI 429 / 402)

- **Anthropic 429** — rate limit. Wait a few seconds or lower request rate.
- **Anthropic 402** / "insufficient_quota" — out of credit. Top up at
  console.anthropic.com → Billing.
- **OpenAI 429** — same shape. Top up at platform.openai.com.
- **Daily spend cap hit** — `ASSISTANT_DAILY_USD_CAP` enforces a hard limit
  on Ian's chat spend per day. The UI shows a cap bar; raise the cap in
  Render env if needed.

---

## Composio action refused

If `GMAIL_SEND_EMAIL` or similar refuses with "connection not found":

1. Composio dashboard → check Gmail is still connected for your Composio
   user id.
2. If disconnected, reconnect and update
   `COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID` on Render.
3. Restart the service (changing the env auto-restarts).

If `sendGuard` refuses with `SendGuardError`, you're in test mode
(`CC_TESTING=1`). That's intentional — real sends only run with
`ALLOW_REAL_SENDS=1`.

---

## WhatsApp webhook not firing

- **Meta**: Developer dashboard → WhatsApp → Configuration → webhook URL
  must match `https://<backend>/webhooks/whatsapp` and the verify token
  must match `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
- **Twilio**: Console → Messaging → WhatsApp Sandbox → "When a message
  comes in" must be `https://<backend>/webhooks/whatsapp/twilio` with
  method `POST`.
- Confirm Render isn't asleep.

---

## Telegram webhook not firing

Register the webhook once per deploy:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<backend>/webhooks/telegram
```

Verify the registration:

```
https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

The `last_error_message` field tells you if Telegram's seeing an error.
