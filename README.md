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

---

## Requirements

- Node 20+ (both frontend and backend run on the same major version)
- A Supabase project (free tier is enough to start)
- Optional integrations the agents can use once configured:
  - Composio for Gmail / Google Calendar / Reddit / GitHub
  - WhatsApp (Meta Cloud API or Twilio Sandbox)
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

npm run dev              # backend on :4000, frontend on :5173
```

Open `http://localhost:5173` and sign in with a Supabase user that has the
`admin` role (see [docs/setup-guide.md](docs/setup-guide.md)).

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
  approvals, writing good requests
- [Setup guide](docs/setup-guide.md) — every env variable, Supabase setup,
  running the migrations, connecting integrations
- [Deployment](docs/deployment.md) — Vercel + Render + Supabase, keeping
  configs in sync, Render free-plan sleeping
- [Architecture](docs/architecture.md) — modules, request flow diagram, tables
- [Workspaces](docs/workspaces.md) — Phase 1–2.3d status, shadow guard, enforce
  mode, Workspace health panel
- [Agents](docs/agents.md) — every agent, its tools, its department
- [Agent value](docs/agent-value.md) — what each agent takes off a person's
  plate
- [Why CodeCraft](docs/why-codecraft.md) — business-facing pitch
- [Testing](docs/testing.md) — safe-mode vs integration mode, baseline results
- [Runbooks](docs/runbooks.md) — backup, migrations, rollback, key rotation
- [API reference](docs/api.md) — every backend route
- [Troubleshooting](docs/troubleshooting.md) — common errors and fixes
- [Changelog](docs/changelog.md) — grouped by date

---

## Status

Live multi-tenant workspaces (shadow guard in enforce mode after Phase 2.3d
backfill). 58 of 63 safe-mode tests pass; 5 pre-existing failures are listed
in [docs/testing.md](docs/testing.md).
