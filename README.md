# CodeCraft

**A team of digital assistants that run the busywork of a small business under human approval.**

CodeCraft gives a business owner a chat window and a set of departments — Sales,
Marketing, Support, Strategy, Development. Each department contains agents that
draft outreach emails, write marketing copy, triage the inbox, run research
briefings, build quick coding tasks, and more. Nothing irreversible (sending a
message, deleting a file, booking a meeting) happens without a human clicking
Approve.

Three services run together:

- **Frontend** — React/Vite dashboard, deployed on Vercel.
- **Backend** — Node/Express server, deployed on Render.
- **Database** — Supabase (Postgres + Auth), one project per deployment.

---

## Main features

- **Chat with Ian** — one text box that routes a plain-English goal to the right
  agent (`intentClassifier` → `orchestrator` → agent).
- **Departments & agents** — 17 agents across Sales, Marketing, Support,
  Strategy, Development, each with a defined set of tools.
- **Approval gate** — every irreversible tool call becomes a pending task that
  the owner approves or rejects.
- **Workflows** — save a goal as a recurring run on an interval, a daily
  schedule, or a folder-watch trigger.
- **Scheduler** — ticks every minute, picks up due workflows, respects
  per-workspace scope.
- **Workspace multi-tenancy** — every row carries a `workspace_id`; a shadow
  guard logs or enforces that scope on every read/write.
- **Workspace health panel** — Settings → Workspace health shows any guard
  misses, with a Clear-log button.
- **Audit log** — every meaningful event is persisted (`activityLog`) and
  streamed to the UI over Server-Sent Events.
- **Google Sheets lead storage** — Sales Manager saves each lead it finds to the
  workspace's own Google Sheet (service account). Setup:
  [docs/connecting-accounts.md](docs/connecting-accounts.md#google-sheets-lead-storage);
  check it with `cd backend && npm run check:sheets`.

---

## Requirements

- Node 20+ (both frontend and backend run on the same major version)
- A Supabase project (free tier is enough to start)
- Optional integrations the agents can use once configured:
  - Composio for Gmail / Google Calendar / Reddit / GitHub
  - WhatsApp: your own phone through a self-hosted WAHA server (default), or
    Meta Cloud API / Twilio Sandbox. See [WhatsApp (WAHA)](#whatsapp-waha) below.
  - Telegram Bot API
  - Tavily (web search), YouTube Data API, OpenAI (image generation)
  - Playwright + a browser extension token for the Browser agent

The system runs with **none** of these configured — a mock provider stands in
for the LLM, and tools that need external credentials refuse clearly instead of
silently mocking.

---

## Install & run (local)

```bash
# From the repo root
npm run install:all      # installs backend + frontend

# Copy the examples and fill in your own values
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# One-time: run SQL migrations in the Supabase SQL Editor
#   backend/database/migrations/0001_workspaces_phase1.sql
#   backend/database/migrations/0002_backfill_null_workspace.sql  (manual, see docs/runbooks.md)
#   backend/database/migrations/0005_whatsapp_waha.sql            (WhatsApp tables)

npm run dev              # backend on :4000, frontend on :5173
```

Open `http://localhost:5173` and sign in with a Supabase user that has the
`admin` role (see [docs/setup-guide.md](docs/setup-guide.md)).

---

## WhatsApp (WAHA)

Each admin links their own WhatsApp by scanning a QR code (Toolbox →
Connections → **Connect WhatsApp**), through [WAHA](https://waha.devlike.pro),
a self-hosted WhatsApp HTTP API. Incoming messages are saved, shown in
Work → **Inbox**, and answered by the WhatsApp agent (sent automatically after
a safety check; risky topics wait for approval). Outreach is queued and sent
30-90 seconds apart, up to `DAILY_WA_LIMIT` per day, skipping anyone who
replied "stop". The existing Twilio code still works with `WHATSAPP_PROVIDER=twilio`.

Run WAHA locally (Docker Desktop):

```bash
docker run -it -p 3000:3000 -e WAHA_API_KEY=your-api-key devlikeapro/waha
```

Then run `backend/database/migrations/0005_whatsapp_waha.sql` in the Supabase
SQL Editor and set these in `backend/.env` (and on Render):

| Variable | Required | What it is |
|---|---|---|
| `WHATSAPP_PROVIDER` | no (default `waha`) | `waha` or `twilio` |
| `WAHA_BASE_URL` | yes for WAHA | WAHA's address as the backend reaches it, e.g. `http://localhost:3000` |
| `WAHA_API_KEY` | yes for WAHA | Same value as the container's `WAHA_API_KEY`; sent as `X-Api-Key` |
| `WAHA_WEBHOOK_SECRET` | yes to receive messages | Random string WAHA signs webhooks with (HMAC-SHA512) |
| `WAHA_WEBHOOK_BASE_URL` | yes to receive messages | This backend's public URL (falls back to `RENDER_EXTERNAL_URL`) |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | no (default `233`) | Added to local numbers like `024…` |
| `DAILY_WA_LIMIT` | no (default `50`) | Outreach messages per WhatsApp account per day |
| `WA_OUTREACH_MIN_GAP_MS` / `WA_OUTREACH_MAX_GAP_MS` | no (30000 / 90000) | Random gap between outreach sends |
| `WA_AUTO_REPLY` | no (default `true`) | `false` = every reply waits for approval |

Full beginner guide (Docker Desktop, ngrok, Supabase, Oracle Cloud free
server, troubleshooting): [docs/whatsapp-waha-setup.md](docs/whatsapp-waha-setup.md).

> WAHA drives WhatsApp Web on a normal WhatsApp account. That is not
> WhatsApp's official Business API: messaging people who don't know you, or
> sending in bulk, can get the number banned. Use a number you can afford to
> lose for outreach, keep the daily limit low, and prefer contacts who expect
> to hear from you.

---

## Repo layout

```
codecraft-ai/
├── README.md                # (this file)
├── docs/                    # all documentation (see links below)
├── backend/                 # Express server, agents, plugins, memory stores
│   ├── agents/              # 17 agents, grouped under agents/<key>/
│   ├── api/                 # route files mounted by server.js
│   ├── core/                # orchestrator, scheduler, workflowEngine, guards
│   ├── memory/              # MemoryStore (in-memory) + SupabaseStore + guard
│   ├── plugins/             # tool actions (gmail, telegram, computer, etc.)
│   ├── database/            # schema.sql + migrations
│   └── scripts/             # test runners, backup, migration helpers
└── frontend/                # React + Vite dashboard
```

---

## Documentation

- [User guide](docs/user-guide.md) — logging in, departments, running tasks,
  approvals, workflows
- [Setup and deploy](docs/setup-and-deploy.md) — environment variables,
  Supabase, migrations, Vercel + Render deploy
- [Architecture](docs/architecture.md) — modules, request flow diagram,
  Supabase tables, workspace multi-tenancy
- [Agents](docs/agents.md) — every agent in one table
- [API](docs/api.md) — every route in one table
- [Why CodeCraft](docs/why-codecraft.md) — business-facing pitch
- [Operations](docs/operations.md) — procedures (backup, migrate, flip
  guard, rollback, rotate keys) and a problem → fix table
- [Testing](docs/testing.md) — safe-mode vs integration mode (reference only)
- [Changelog](docs/changelog.md) — grouped by date
- [TODO](docs/TODO.md) — small open items the docs reference

---

## Status

Live multi-tenant workspaces (shadow guard in enforce mode after Phase 2.3d
backfill). 58 of 63 safe-mode tests pass; 5 pre-existing failures are listed
in [docs/testing.md](docs/testing.md).
