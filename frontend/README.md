# CodeCraft AI — Frontend

Dashboard for the full platform, matching the backend's real API surface. Runs
standalone with demo data if the backend isn't reachable, and switches to live
data automatically when it is.

## Design tokens
- **Palette**: near-black bg (`#0A0A0B`), orange accent (`#FF5A1F`), off-white
  text (`#F2F1ED`) — see `src/index.css`.
- **Type**: Space Grotesk (display), Inter (body), IBM Plex Mono (data/logs).
- **Signature element**: the Console page — a real chronological trace of
  orchestrator events grouped per task, not decorative numbering.

## Pages
- **Overview** — stats, pending-approval banner, live activity feed, installed tools/providers
- **Chat** — submit a goal directly to the orchestrator
- **Console** — live + historical event trace, grouped per task
- **Tasks** — full task list with inline approve/reject for irreversible actions
- **Job Outreach** — the job/lead outreach pipeline
- **Research** — dedicated research-agent view
- **Workflows** — create/edit/enable scheduled recurring goals, including
  per-workflow automated WhatsApp delivery
- **Intelligence** — the Briefing Agent's aggregated dashboard (trending
  topics, latest collected articles, a 7-day activity chart)
- **Analytics** — usage/activity summaries
- **Agents** — cards for each registered agent (role, goals, tools)
- **Plugins** — catalog reflecting what's actually loaded on the backend
- **Skills** — the Universal Skill Installer UI

## Command palette
Cmd+K / Ctrl+K anywhere — navigate, or type a goal and hit Enter to submit it
straight to the orchestrator.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173, expects backend at localhost:4000
```

Set `VITE_API_URL` in `.env` to point elsewhere. Without a reachable backend,
the UI runs fine on demo data (submit/approve actions are just disabled).