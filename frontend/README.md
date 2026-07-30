# CodeCraft AI — Frontend Shell

Dark-first dashboard shell matching the backend's API surface. Runs standalone
with demo data if the backend isn't reachable, and switches to live data
automatically when it is.

## Design tokens
- **Palette**: near-black bg (`#0A0A0B`), orange accent (`#FF5A1F`), off-white text (`#F2F1ED`) — see `src/index.css`.
- **Type**: Space Grotesk (display), Inter (body), IBM Plex Mono (data/logs).
- **Signature element**: the activity rail on Overview — a real chronological timeline of orchestrator events, not decorative numbering.

## Pages
- **Overview** — stats, pending-approval banner, live activity feed, installed tools/providers
- **Agents** — cards for each registered agent (role, goals, tools)
- **Tasks** — full task list with inline approve/reject for irreversible actions
- **Plugins** — install-style catalog, reflects what's actually loaded on the backend
- **Workflows** — placeholder for the visual builder (not built yet)
- **Chat** — submit a goal directly to the orchestrator

## Command palette
Cmd+K / Ctrl+K anywhere — navigate, or type a goal and hit Enter to submit it straight to the orchestrator.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173, expects backend at localhost:4000
```

Set `VITE_API_URL` in `.env` to point elsewhere. Without a reachable backend, the UI runs fine on demo data (submit/approve actions are just disabled).

## What's not built yet
Workflow builder, plugin install flow (UI only, not wired to a real install endpoint), voice input/output, file uploads, multi-conversation chat history. These are separate pieces from the architecture doc, not part of this shell.
