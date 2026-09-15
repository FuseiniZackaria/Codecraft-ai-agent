markdown
# CodeCraft AI v1.0

**Build. Automate. Scale.**

A multi-agent business automation platform: an orchestrator routes natural-language
goals to specialized agents, gates any irreversible action behind human approval,
and logs everything to a real audit trail.

codecraft-ai/
├── docs/
│ └── architecture.md # folder structure, orchestrator/agent design,
│ # plugin & skill SDKs, Supabase schema, API surface
├── backend/ # Express server — orchestrator, agents, plugins,
│ # approval gate, audit log, Supabase persistence
└── frontend/ # React + Vite dashboard — dark/orange/white
# branding, command palette, live task approvals


## Quick start

```bash
npm run install:all   # installs both backend and frontend dependencies
npm run dev           # starts both together (backend on :4000, frontend on :5173)
```

Open `localhost:5173`. It auto-detects the backend and switches from demo data
to live data. Each folder has its own README with details and example commands.

## Status

This project has grown well past its original scaffold. Rather than a single
"working vs. not" line, here's an honest breakdown:

**Tested and confirmed working, end-to-end:**
- **Orchestrator** — goal decomposition, agent routing, approval gating for
  irreversible actions, full audit logging
- **Local Computer Operator agent** — filesystem search, directory inspection,
  opening files/folders (with a hard block on executables), disk-space and
  duplicate-file analysis, and Recycle Bin deletion gated behind a real
  approval step (verified: a delete *request* never touches disk until a
  human explicitly approves it)
- **Briefing Agent** — multi-source web research merged into one cited brief,
  memory across recurring runs (explicitly flags what's new/changed vs. the
  last run), formatted `.docx` report generation, and opt-in automated
  WhatsApp delivery per scheduled workflow
- **Intelligence dashboard** — a real aggregation API over persisted article
  data (trend direction, "gaining attention" topics, a 7-day activity chart),
  not mocked numbers
- **Supabase persistence** — the live database backing tasks, reflections,
  audit logs, workflows, and all of the above; not an in-memory stub
- **Scheduled workflows** — recurring goals on an interval or daily schedule,
  checked every minute, survives backend restarts

**Present in the codebase as real, tracked code** (built in earlier sessions,
not independently re-verified in the pass that produced this note — see each
subsystem's own code/tests for its actual status): Sales, WhatsApp, Telegram,
Browser, Job Verification, Response Detection, and Scheduling agents; Gmail,
Telegram, Google Calendar, and browser-automation plugins; the job outreach
pipeline.

**Reference for extending any of the above:** `docs/architecture.md` documents
the orchestrator/agent design and plugin SDK pattern that every piece above
was built against.