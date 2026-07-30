# CodeCraft AI v1.0

**Build. Automate. Scale.**

Everything built so far, in one place:

```
codecraft-ai/
├── docs/
│   └── architecture.md     # folder structure, orchestrator/agent design,
│                            # plugin & skill SDKs, Supabase schema, API surface
├── backend/                 # working Express server — orchestrator, Research
│                            # Agent, Gmail plugin, approval gate, audit log
└── frontend/                 # React + Vite dashboard shell — dark/orange/white
                              # branding, command palette, live task approvals
```

## Quick start

Everything runs from this one folder — no need to `cd` into `backend`/`frontend` separately:

```bash
npm run install:all   # installs both backend and frontend dependencies
npm run dev           # starts both together (backend on :4000, frontend on :5173)
```

Open `localhost:5173`. It auto-detects the backend and switches from demo data
to live data. Each folder has its own README with details and example commands
if you ever want to run them individually.

## Status

Working now: orchestrator, one agent (Research), one plugin (Gmail, mocked
network calls), approval-gated irreversible actions, audit log, dashboard UI.

Designed but not connected: the other 12 agents, remaining plugins, real
OAuth, Supabase persistence, RAG ingestion, workflow engine, marketplace.
`docs/architecture.md` is the reference for building each of those the same
way the current pieces were built.
