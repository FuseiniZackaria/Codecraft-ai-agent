# CodeCraft AI — Backend

Orchestrator, agents, plugins, approval-gated irreversible actions, audit
logging, and Supabase persistence — wired together and tested end-to-end.

## Core pieces

- **Orchestrator** (`core/orchestrator/`): decomposes a goal into tasks, routes
  to an agent, blocks irreversible actions for human approval, logs everything.
- **Model router** (`core/router.js`): scores providers by capability/cost/speed.
  Uses a **mock provider** by default so it runs with zero API keys; drop in
  `AI_API_KEY` (see `.env.example`) to route to real AI calls — no code changes needed.
- **Scheduler** (`core/scheduler.js`): runs scheduled workflows on an interval
  or daily schedule, checked every minute.
- **ToolRegistry**: plugins register actions here; agents call tools by name
  without knowing which plugin implements them.
- **SupabaseStore** (`memory/`): the real persistence layer for tasks,
  reflections, audit logs, workflows, briefing runs/articles, and more —
  matches `database/schema.sql`.
- **REST API** (`api/`): one route file per subsystem (tasks, workflows,
  dashboards, events, skills, workspace, browser, MCP).

## Agents with tested, end-to-end coverage

- **Computer Operator** (`agents/computer-operator/`) — local filesystem
  search, directory inspection, opening files/folders (hard-blocked for
  executables), disk-space and duplicate-file analysis, and Recycle Bin
  deletion. Deletion always goes through `createApprovalTask()`, never a
  direct action — see `tests/computer-operator-recyclebin.test.js` for the
  test proving a delete request never touches disk without explicit approval.
- **Briefing Agent** (`agents/briefing/`) — multi-source research merged into
  one cited brief, with memory across recurring runs
  (`memory.getLatestBriefingRun`/`saveBriefingRun`), a formatted `.docx`
  report (`core/briefing/reportBuilder.js`), persisted article data powering
  the Intelligence dashboard (`core/briefing/dashboardStats.js`), and opt-in
  automated WhatsApp delivery per workflow.

## Other agents/plugins present in the codebase

Sales, WhatsApp, Telegram, Browser, Job Verification, Response Detection, and
Scheduling agents; Gmail, Telegram, Google Calendar, and browser-automation
plugins. These are real, tracked code from earlier build sessions — check
their own test files (`tests/*.test.js`) for current coverage per piece.

## Running it

```bash
npm install
cp .env.example .env      # fill in real keys for live behavior; works with none set (mock mode)
npm start                 # http://localhost:4000
```

## Tests

Each subsystem has its own test file under `tests/`, runnable individually:

```bash
node tests/computer-operator-recyclebin.test.js
node tests/briefing-report.test.js
node tests/dashboard-stats.test.js
# ...and others per subsystem
```

## Database

`database/schema.sql` is the real, live Supabase schema (with pgvector) this
backend runs against — not a design doc. Run it against a fresh Supabase
project to set up persistence.