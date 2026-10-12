# Setup guide

How to get a new CodeCraft deployment working end-to-end. Values shown are
**placeholders only** — never paste a real key into any file that will be
committed. All real values live in a `.env` file (gitignored) or in the Render
Environment tab.

---

## 1. Environment variables

Grouped by purpose. "Required" means the system refuses to start or the
dependent feature is unusable; "optional" means the feature is turned off until
you set it.

### Core

| Name | Purpose | Required | Where to get it | Lives on |
|---|---|---|---|---|
| `PORT` | Port the backend listens on | optional (default 4000) | — | Render |
| `NODE_ENV` | `production` on Render, unset locally | optional | — | Render |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed origins | required in prod | Your Vercel URL + localhost for dev | Render |
| `ASSISTANT_NAME` | What the chat assistant calls itself | optional (default `Ian`) | — | Render |
| `ASSISTANT_NAME_VARIATIONS` | Alternate spellings Ian answers to | optional | — | Render |
| `ASSISTANT_MODEL` | Anthropic model id | optional (default `claude-sonnet-5-5`) | Anthropic docs | Render |
| `ASSISTANT_MAX_TOKENS` | Per-call cap | optional (default 1024) | — | Render |
| `ASSISTANT_DAILY_USD_CAP` | Hard cap on Ian's daily LLM spend | optional (default 5) | — | Render |
| `ASSISTANT_HISTORY_LIMIT` | Chat messages kept in context | optional (default 30) | — | Render |

### Supabase (database + auth)

| Name | Purpose | Required | Where to get it | Lives on |
|---|---|---|---|---|
| `SUPABASE_URL` | Project URL | required | Supabase → Project settings → API | Render |
| `SUPABASE_SERVICE_KEY` | **Service role** key (bypasses RLS) | required | Supabase → Project settings → API | Render only — **never** on Vercel |
| `SUPABASE_ANON_KEY` | Public anon key | required | Supabase → Project settings → API | Render + Vercel (as `VITE_SUPABASE_ANON_KEY`) |

### AI providers

| Name | Purpose | Required | Where to get it | Lives on |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (Ian + classifier + most agents) | required | console.anthropic.com | Render |
| `AI_API_KEY` | Fallback for `ANTHROPIC_API_KEY` | optional | — | Render |
| `OPENAI_API_KEY` | OpenAI (used for image generation only) | optional | platform.openai.com | Render |
| `OPENAI_IMAGE_MODEL` | Image model id | optional (default `gpt-image-1`) | — | Render |

If no provider key is set, the router falls back to a mock provider so the
system still runs — but every agent will return canned text.

### Composio (Gmail, Google Calendar, Reddit, GitHub)

| Name | Purpose | Required | Where to get it | Lives on |
|---|---|---|---|---|
| `COMPOSIO_API_KEY` | Composio API key | required for Gmail/Calendar/Reddit/GitHub | app.composio.dev | Render |
| `COMPOSIO_USER_ID` | Composio user id | optional (default `default`) | — | Render |
| `COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID` | The id Composio assigns when you connect Gmail | required for Gmail | Composio dashboard after connecting | Render |
| `COMPOSIO_REDDIT_CONNECTED_ACCOUNT_ID` | Same, for Reddit | optional | Composio dashboard | Render |
| `COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID` | Same, for GitHub | optional | Composio dashboard | Render |

### WhatsApp

Pick **one** channel:

| Name | Purpose | Required | Where to get it | Lives on |
|---|---|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Cloud API phone-number id | required (Meta path) | developers.facebook.com → WhatsApp | Render |
| `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API token | required (Meta path) | Same | Render |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Any string you choose; Meta uses it for webhook handshake | required (Meta path) | You pick it | Render |
| `TWILIO_ACCOUNT_SID` | Twilio SID | required (Twilio path) | console.twilio.com | Render |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | required (Twilio path) | console.twilio.com | Render |
| `TWILIO_WHATSAPP_FROM` | Sender number | optional (default sandbox `whatsapp:+14155238886`) | Your approved sender once provisioned | Render |

### Telegram

| Name | Purpose | Required | Where to get it | Lives on |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token | required for Telegram agent | @BotFather on Telegram, `/newbot` | Render |
| `TELEGRAM_WEBHOOK_SECRET` | Optional secret header Telegram passes back | optional | You pick it | Render |

### Other services

| Name | Purpose | Required | Where | Lives on |
|---|---|---|---|---|
| `TAVILY_API_KEY` | Web search for Research/Briefing/Marketing/Verification | required for those agents | tavily.com | Render |
| `YOUTUBE_API_KEY` | YouTube Data API | required for Content Studio YouTube search | console.cloud.google.com | Render |
| `BROWSER_EXTENSION_TOKEN` | Shared secret between backend + browser extension (also gates `/api/mcp`) | required for Browser agent | You pick it | Render + the extension's settings |

### Outreach (Sales pipeline)

| Name | Default | Purpose |
|---|---|---|
| `OUTREACH_MODE` | `manual` | `manual` / `semi_automatic` / `automatic` |
| `OUTREACH_AUTOMATIC_ENABLED` | `false` | Hard switch for automatic mode; even `automatic` won't auto-send until this is `true` |
| `OUTREACH_VERIFICATION_THRESHOLD` | `75` | Minimum verification score to proceed |
| `OUTREACH_ALLOW_LIKELY_CURRENT` | `false` | Allow `LIKELY_CURRENT` postings in addition to `VERIFIED` |
| `OUTREACH_DAILY_SEND_LIMIT` | `20` | Max auto-sends per day |
| `OUTREACH_FOLLOWUP_DAYS` | `4,10,21` | Day offsets for follow-ups |
| `OUTREACH_MAX_FOLLOWUPS` | `3` | Cap on follow-up emails |
| `OUTREACH_RESPONSE_CHECK_INTERVAL_MINUTES` | `0` (off) | Response-detection scheduler |
| `OUTREACH_FOLLOWUP_CHECK_INTERVAL_MINUTES` | `0` (off) | Follow-up scheduler |

### Scheduling (meeting-booking agent)

`SCHEDULING_WORKING_DAYS`, `SCHEDULING_START_HOUR`, `SCHEDULING_END_HOUR`,
`SCHEDULING_SLOT_MINUTES`, `SCHEDULING_DAYS_AHEAD`, `SCHEDULING_TIMEZONE`,
`SCHEDULING_REMINDER_MINUTES`, `SCHEDULING_SLOTS_TO_PROPOSE`. All optional, see
`backend/config/index.js` for defaults.

### Auto-reply (customer messages)

| Name | Default | Purpose |
|---|---|---|
| `TELEGRAM_AUTO_REPLY_ENABLED` | `false` | Allow Telegram auto-reply (still passes through `autoReplySafety`) |
| `WHATSAPP_AUTO_REPLY_ENABLED` | `false` | Same for WhatsApp |
| `AUTO_REPLY_MAX_LENGTH` | `800` | Char cap on auto-sent replies |
| `AUTO_REPLY_DAILY_LIMIT` | `20` | Max auto-replies per channel per day |

### Owner notifications

| Name | Purpose |
|---|---|
| `OWNER_TELEGRAM_CHAT_ID` | Where to ping owner when a customer message is waiting |
| `OWNER_WHATSAPP_NUMBER` | Same for WhatsApp |

### Applicant profile (used by Job Application + system-digest emails)

| Name | Purpose |
|---|---|
| `APPLICANT_FULL_NAME`, `APPLICANT_EMAIL`, `APPLICANT_PHONE`, `APPLICANT_LINKEDIN_URL`, `APPLICANT_PORTFOLIO_URL`, `APPLICANT_LOCATION`, `APPLICANT_YEARS_EXPERIENCE`, `APPLICANT_SKILLS`, `APPLICANT_COVER_LETTER` | Used to fill application forms and sign outreach |
| `MY_EMAIL_ADDRESSES` | Comma-separated — Inbox triage drops emails from these to avoid replying to yourself |

**`APPLICANT_EMAIL` is also the one and only address that `systemDigest` emails
can be sent to.** The Gmail guard refuses anything else on that path.

### Computer Operator (local filesystem agent)

| Name | Purpose |
|---|---|
| `COMPUTER_ALLOWED_ROOTS` | Comma-separated absolute paths the agent is allowed to read/write |
| `COMPUTER_ALLOWED_APPS` | Apps the agent may launch (openFile/openFolder) |
| `COMPUTER_MAX_SEARCH_RESULTS` | Cap on search results per call |
| `COMPUTER_MAX_DELETE_BATCH` | Cap on how many items one approved delete can affect |

### Browser agent

| Name | Purpose |
|---|---|
| `BROWSER_PROFILE_DIR` | Playwright profile directory |
| `BROWSER_HEADLESS` | `true` / `false` |

### Testing flags (do not set in production)

| Name | Purpose |
|---|---|
| `CC_TESTING=1` | Blocks real sends via `sendGuard`; test runner sets this |
| `CC_FORCE_MEMORY_STORE=1` | Forces in-memory store instead of Supabase; test runner sets this |
| `CC_FORCE_MOCK_PROVIDER=1` | Forces the mock LLM provider; test runner sets this |
| `ALLOW_REAL_SENDS=1` | Explicit opt-in to allow real outbound sends even in test mode (never set in prod — prod doesn't need it) |

### Workspace guard

| Name | Default | Purpose |
|---|---|---|
| `WORKSPACE_GUARD_MODE` | `log` | `log` records misses to a shadow log; `enforce` throws `WorkspaceGuardError` on any unscoped user call. See [workspaces.md](workspaces.md). |

### Legacy

| Name | Purpose |
|---|---|
| `GMAIL_TRIAGE_INTERVAL_MINUTES` | Pre-workflow era auto-triage. On startup, if set and no equivalent workflow exists, the scheduler migrates it into a real workflow row. Prefer setting up the workflow in the UI instead. |

### Frontend (`VITE_*` — baked into the build on Vercel)

| Name | Purpose |
|---|---|
| `VITE_API_URL` | Full URL of the backend (e.g. `https://codecraft-backend.onrender.com`) |
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Same as `SUPABASE_ANON_KEY` |
| `VITE_BROWSER_EXTENSION_TOKEN` | Shared with `BROWSER_EXTENSION_TOKEN` (only if browser extension is used) |

---

## 2. Supabase setup

1. Create a new Supabase project.
2. Project settings → API → copy `URL`, `anon public key`, and `service_role
   key`.
3. Authentication → Users → **Add user** → create your admin user (email +
   password; confirm the email).
4. Grant the admin role (next steps happen inside the SQL Editor).

---

## 3. Running the migrations

Open the Supabase **SQL Editor**. Paste each file's contents and run it.

### 3a. Base schema

`backend/database/schema.sql` — all the business tables (`tasks`,
`chat_messages`, `audit_log`, `scheduled_workflows`, etc.) plus `roles` and
`user_roles`. Create your admin role row and grant it to your user:

```sql
-- replace with the admin user's auth.users.id (copy from Supabase → Authentication)
insert into roles (name) values ('admin') on conflict do nothing;
insert into user_roles (user_id, role_id)
  select '<admin-user-uuid>', id from roles where name = 'admin';
```

### 3b. Workspaces Phase 1 — `0001_workspaces_phase1.sql`

Adds the `workspaces` / `workspace_members` / `workspace_connections` /
`business_profile` tables, puts a nullable `workspace_id` column on 14
existing tables, creates one workspace for the admin, and sets up the shadow
RLS trigger. Idempotent — safe to re-run.

> **TODO: confirm** — the file hard-codes a specific admin email on
> roughly line 170 to find who to make the owner. If your admin uses a
> different email, change that line **before** running the file, or run a
> one-line follow-up `update workspace_members set user_id = '<new-admin-uuid>'`
> after the fact. (The hard-coded value is visible when you open the file;
> we keep it out of the docs so published docs don't name a specific person.)

### 3c. Workspaces Phase 2.3d backfill — `0002_backfill_null_workspace.sql`

This file is **mostly commented out on purpose**. Running it as-is does
nothing — the real backfill block only runs after you uncomment it. The
file includes:

1. Two review queries at the top — run first, confirm you have exactly one
   workspace and understand the per-table null counts.
2. A commented-out `DO $$ … $$;` block that stamps every null-workspace row
   with that workspace's id. **Uncomment and run only after the review
   looks right.**
3. A final verification block — every count should be 0.

Full step-by-step: see [runbooks.md § Running a migration safely](runbooks.md).

---

## 4. Connecting integrations

### Gmail (Composio)

1. Composio dashboard → Apps → Gmail → **Connect Gmail**. Complete Google
   OAuth with the admin account you want to send from.
2. Composio shows a Connected Account id — paste it into
   `COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID` on Render.
3. Restart the backend. The Dashboard tile for Gmail now shows "connected".

### Google Calendar / Reddit / GitHub (Composio)

Same pattern — one `COMPOSIO_<APP>_CONNECTED_ACCOUNT_ID` env per app.

### WhatsApp — Meta Cloud API

1. Create a Meta Business app, add the WhatsApp product.
2. Get the test phone number id and a short-lived access token (promote to a
   long-lived one before production).
3. Set `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
4. In Meta's dashboard, point the Webhooks tab at
   `https://<backend>/webhooks/whatsapp` and paste the same verify token.

### WhatsApp — Twilio Sandbox

Faster to start with for a demo.

1. Twilio Console → Messaging → WhatsApp Sandbox → opt-in by texting `join <keyword>`
   from each phone that will receive messages.
2. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`. Default
   `TWILIO_WHATSAPP_FROM` is the shared sandbox number.
3. Point the Sandbox webhook at `https://<backend>/webhooks/whatsapp/twilio`.

### Telegram

1. Message `@BotFather` → `/newbot` → choose a name → copy the bot token.
2. Set `TELEGRAM_BOT_TOKEN`.
3. Register the webhook once:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<backend>/webhooks/telegram`

### Browser extension / MCP token

Both `/api/browser/*` and `/api/mcp/*` are protected by a shared
`BROWSER_EXTENSION_TOKEN`. The extension sends it as the `X-CodeCraft-Token`
header. Pick any long random string, put the same value in both the backend
env (`BROWSER_EXTENSION_TOKEN`) and the extension's settings.

---

## 5. Running locally vs production

**Local dev** — `npm run dev` from the repo root runs backend on port 4000 and
frontend on port 5173. Frontend auto-detects the backend. The `.env` files sit
next to each `package.json`.

**Production** — frontend is a static build (Vercel), backend runs on Render.
Both read env vars from their respective Environment tabs; the frontend's
`VITE_*` vars are baked into the build at deploy time, so changing them
requires a redeploy. See [deployment.md](deployment.md).

---

## 6. House-keeping notes

- **Root `package.json` lists `docx` as a dependency** even though backend
  already carries it. Harmless but worth cleaning up on the next refactor.
- Nothing reads a `MANUAL_TASKS_EMAIL` env variable in the current code. The
  system-digest path reads `APPLICANT_EMAIL`. If you want a different owner
  address, either change `APPLICANT_EMAIL` or add a new config entry.
