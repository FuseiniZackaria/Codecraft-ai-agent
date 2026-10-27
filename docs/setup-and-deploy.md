# Setup and deployment

Everything needed to stand up a new CodeCraft instance: configuration,
Supabase, three services (Vercel + Render + Supabase), and the first checks
after a deploy.

---

## 1. The three services

| Service | What runs there | Deploys from | Reads env from |
|---|---|---|---|
| **Vercel** | React/Vite static build (frontend only) | `main` on push, root `frontend/` | Vercel → Environment (baked into the build; `VITE_*` names) |
| **Render** | Node/Express backend (all agents, scheduler, orchestrator, Supabase service-key client) | `main` on push, root `backend/` | Render → Environment (read at runtime) |
| **Supabase** | Postgres database + authentication | Not deployed — a long-lived project | — |

The Supabase **service_role** key only ever lives on Render. The frontend
uses the public anon key.

---

## 2. Environment variables

Only the names appear in this doc. **Never paste real values anywhere in
`/docs`.** Real values go in `backend/.env` (gitignored) locally and in
Render → Environment / Vercel → Environment for production.

### Core

| Name | Required? | Where it lives | Notes |
|---|---|---|---|
| `PORT` | optional (default 4000) | Render | — |
| `NODE_ENV` | optional (`production` on Render) | Render | — |
| `CORS_ALLOWED_ORIGINS` | required in prod | Render | Comma-separated: Vercel URL + localhost for dev |
| `ASSISTANT_NAME` | optional (default `Ian`) | Render | What the chat calls itself |
| `ASSISTANT_NAME_VARIATIONS` | optional | Render | Alternate spellings the assistant answers to |
| `ASSISTANT_MODEL` | optional (default `claude-sonnet-5-5`) | Render | Anthropic model id |
| `ASSISTANT_MAX_TOKENS` | optional (default 1024) | Render | — |
| `ASSISTANT_DAILY_USD_CAP` | optional (default 5) | Render | Hard cap on daily chat spend |
| `ASSISTANT_HISTORY_LIMIT` | optional (default 30) | Render | — |

### Supabase

| Name | Required? | Where | Notes |
|---|---|---|---|
| `SUPABASE_URL` | required | Render | Project URL |
| `SUPABASE_SERVICE_KEY` | required | **Render only** | Service role — bypasses RLS |
| `SUPABASE_ANON_KEY` | required | Render + Vercel (`VITE_SUPABASE_ANON_KEY`) | Public anon key |

### Model providers

`ANTHROPIC_API_KEY` (required, Render), `AI_API_KEY` (optional fallback),
`OPENAI_API_KEY` (optional, image generation only), `OPENAI_IMAGE_MODEL`
(optional, default `gpt-image-1`). If no provider key is set, the router
falls back to a mock provider and every agent returns canned text.

### Integrations

| Group | Env vars | Lives on |
|---|---|---|
| Google Sheets lead storage | `GOOGLE_SERVICE_ACCOUNT_JSON` (key JSON) or `GOOGLE_SERVICE_ACCOUNT_FILE` (key path), `LEADS_SHEET_ID` (owner-workspace fallback) — see [connecting-accounts.md](connecting-accounts.md#google-sheets-lead-storage) | Render |
| Composio (Gmail, Google Calendar, Reddit, GitHub) | `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID`, `COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID`, `COMPOSIO_REDDIT_CONNECTED_ACCOUNT_ID`, `COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID` (the pinned ids are used only by the app owner's workspace; every other workspace connects its own account) | Render |
| WhatsApp (Meta) | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Render |
| WhatsApp (Twilio) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | Render |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Render |
| Web search | `TAVILY_API_KEY` | Render |
| YouTube | `YOUTUBE_API_KEY` | Render |
| Browser extension / MCP | `BROWSER_EXTENSION_TOKEN` (one shared token) | Render + extension |

### Outreach pipeline

`OUTREACH_MODE` (`manual` / `semi_automatic` / `automatic`, default
`manual`), `OUTREACH_AUTOMATIC_ENABLED` (default off),
`OUTREACH_VERIFICATION_THRESHOLD` (default 75),
`OUTREACH_ALLOW_LIKELY_CURRENT` (default off), `OUTREACH_DAILY_SEND_LIMIT`
(default 20), `OUTREACH_FOLLOWUP_DAYS` (default `4,10,21`),
`OUTREACH_MAX_FOLLOWUPS` (default 3),
`OUTREACH_RESPONSE_CHECK_INTERVAL_MINUTES` (default 0 = off),
`OUTREACH_FOLLOWUP_CHECK_INTERVAL_MINUTES` (default 0 = off).

### Scheduling / auto-reply / owner / applicant / computer / browser / testing

See `backend/config/index.js` for the full list, every one defaulted. Highlights:

- `TELEGRAM_AUTO_REPLY_ENABLED`, `WHATSAPP_AUTO_REPLY_ENABLED` — both default
  off. `AUTO_REPLY_MAX_LENGTH`, `AUTO_REPLY_DAILY_LIMIT` cap the auto-sends.
- `APPLICANT_EMAIL` — the one and only address that owner-digest emails may
  be sent to. The Gmail guard refuses any other recipient on that path.
- `MY_EMAIL_ADDRESSES` — comma-separated; inbox-triage drops messages from
  these so you don't reply to yourself.
- `COMPUTER_ALLOWED_ROOTS`, `COMPUTER_ALLOWED_APPS`, `COMPUTER_MAX_DELETE_BATCH` —
  hard limits for the Computer Operator agent.
- Testing flags: `CC_TESTING`, `CC_FORCE_MEMORY_STORE`,
  `CC_FORCE_MOCK_PROVIDER`, `ALLOW_REAL_SENDS`. Never set in production.
- `WORKSPACE_GUARD_MODE` — `log` (default) or `enforce`. See
  [architecture.md § Workspaces](architecture.md).

### Frontend

`VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_BROWSER_EXTENSION_TOKEN`. These are baked into the frontend build at
deploy time; changing one needs a redeploy.

---

## 3. Supabase setup

1. Create a new Supabase project.
2. Project settings → API → copy `URL`, `anon public key`, and `service_role`
   key.
3. Authentication → Users → **Add user** → create the admin user.
4. Open the SQL Editor and run migrations (next section).

---

## 4. Migrations

| File | Purpose |
|---|---|
| `backend/database/schema.sql` | Base tables + roles |
| `backend/database/migrations/0001_workspaces_phase1.sql` | Adds workspaces, puts `workspace_id` on 14 existing tables, backfills one workspace for the admin, installs the shadow RLS trigger. Idempotent — safe to re-run. |
| `backend/database/migrations/0002_backfill_null_workspace.sql` | Stamps every pre-Phase-2 null-workspace row with the single workspace's id. **Ships mostly commented out on purpose** — see [operations.md § Running a migration](operations.md). |

After `schema.sql`:

```sql
insert into roles (name) values ('admin') on conflict do nothing;
insert into user_roles (user_id, role_id)
  select '<admin-user-uuid>', id from roles where name = 'admin';
```

The admin email picked up by migration 0001 is **hard-coded on line ~170**.
If your admin uses a different email, edit that line before running — the
value is visible when you open the file; it's deliberately kept out of the
docs so published docs don't name a specific person.

---

## 5. Local development

```bash
npm run install:all
cp backend/.env.example backend/.env     # fill in values
cp frontend/.env.example frontend/.env   # fill in values
npm run dev
```

Backend on `:4000`, frontend on `:5173`. Frontend auto-detects the backend.

---

## 6. Deploying

### Backend (Render)

- **Build:** `npm install --prefix backend`
- **Start:** `npm start --prefix backend`
- Auto-deploys on push to `main`.
- Manual redeploy from the Render dashboard; the Events tab shows the commit
  SHA that is live. Compare against `git rev-parse --short HEAD`.
- Logs: `[scheduler] started - checking workflows every minute` on startup
  confirms the server is up.

### Frontend (Vercel)

- Framework preset: **Vite**, root `frontend/`, build `npm run build`,
  output `dist`.
- `frontend/vercel.json` rewrites unknown paths to `index.html` so a hard
  refresh on `/tasks` doesn't 404.

### Keeping configs in sync

Local `.env` doesn't reach production. After changing a value locally,
copy the same name/value into Render → Environment (or Vercel for `VITE_*`
names). Render auto-restarts on save.

---

## 7. The sleeping problem (low-cost hosting)

On free Render, the service sleeps after 15 minutes of no traffic and takes
~30 seconds to wake. While asleep, the scheduler doesn't tick, so a
workflow scheduled for a specific time only runs if the server was awake
then. For reliable schedules, use a paid plan or ping the backend from an
external uptime checker.

---

## 8. Post-deploy checklist

- `GET https://<backend>/health` returns 200.
- Sign in to the frontend, land on the Dashboard, no console errors.
- `GET /api/me` returns your email, `role: 'admin'`, workspace fields
  populated.
- Settings → **Workspace health** panel is empty, apart from allowlisted
  scheduler-tick reads.
- Test chat with the assistant returns a reply.
- A test workflow (e.g. "every 5 minutes return the current time") runs and
  appears on the Workflows page.

---

## 9. Connecting integrations

### Gmail (Composio)

1. Composio dashboard → Apps → Gmail → **Connect** → sign in with the
   admin's Google account.
2. Copy the Connected Account id into
   `COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID` on Render.
3. The Dashboard tile for Gmail now shows "connected".

### Google Calendar / Reddit / GitHub (Composio)

Same pattern — one `COMPOSIO_<APP>_CONNECTED_ACCOUNT_ID` env per app.

### WhatsApp — Meta

Create a Meta Business app with the WhatsApp product; set
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`; point Meta's Webhooks tab at
`https://<backend>/webhooks/whatsapp` with the same verify token.

### WhatsApp — Twilio

Opt in by texting `join <keyword>` to the sandbox number from every phone
that will receive messages. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
Point the Twilio webhook at `https://<backend>/webhooks/whatsapp/twilio`.

### Telegram

Message `@BotFather` → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`.
Register the webhook once:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<backend>/webhooks/telegram
```

### Browser extension / MCP token

Pick a long random string, set `BROWSER_EXTENSION_TOKEN` on Render, and set
the same value in the extension's settings. The token gates both
`/api/browser/*` and `/api/mcp/*`.

---

## 10. House-keeping

- The root `package.json` lists `docx` as a dependency even though the
  backend already carries it. Harmless, worth cleaning up on the next
  refactor.
- Nothing in the current code reads a `MANUAL_TASKS_EMAIL` env variable.
  Owner-digest emails use `APPLICANT_EMAIL`.
