# CodeCraft AI v1.0 — Backend Skeleton

A real, runnable slice of the full architecture: orchestrator, one working
agent, one working plugin, approval-gated irreversible actions, and an audit
log — all wired together and tested end-to-end.

## What's actually working here

- **Orchestrator** (`core/orchestrator/`): decomposes a goal into tasks, routes
  to an agent, blocks irreversible actions for human approval, logs everything.
- **Model router** (`core/router.js`): scores providers by capability/cost/speed.
  Uses a **mock provider** by default so it runs with zero API keys; drop in
  `AI_API_KEY` (see `.env.example`) and it automatically routes to real
  AI calls instead — no code changes needed.
- **Research Agent** (`agents/research/`): real multi-step planning
  (research → summarize), extends `BaseAgent` which any new agent (CEO,
  Sales, Support, ...) can also extend.
- **Gmail plugin** (`plugins/gmail/`): auto-discovered at startup via
  `manifest.json`, exposes `sendEmail` (irreversible → requires approval) and
  `readInbox`. Mocked because no Google OAuth credentials are configured in
  this environment — the interface is real, only the actual network call is
  stubbed. Swapping in real OAuth is a change inside `sendEmail.js` only.
- **ToolRegistry**: plugins register actions here; agents call tools by name
  without knowing which plugin implements them.
- **MemoryStore**: in-memory implementation of the task/agent/reflection/audit
  memory layers, matching the schema in `database/schema.sql` so it can be
  swapped for real Supabase calls without touching callers.
- **REST API** (`api/routes.js`): matches the surface in the architecture doc.

## What's stubbed / not yet built

- Only one agent (Research) and one plugin (Gmail) are implemented — the
  registry pattern (`agents/registry.js`, plugin auto-discovery) is what
  makes adding the other 12 agents / other plugins mechanical, not architectural.
- Real Gmail OAuth, Supabase persistence, and RAG ingestion are designed
  (schema + interfaces exist) but not connected to live services.
- No workflow engine, marketplace, or frontend yet — those are separate pieces.

## Running it

```bash
npm install
cp .env.example .env      # optional — works with no keys set
npm start                 # http://localhost:4000
npm test                  # integration test of the full pipeline
```

## Try it

```bash
# Non-irreversible goal — runs immediately
curl -X POST localhost:4000/api/orchestrator/goal \
  -H "Content-Type: application/json" \
  -d '{"goal":"Research our top 3 competitors"}'

# Irreversible goal — pauses for approval
curl -X POST localhost:4000/api/orchestrator/goal \
  -H "Content-Type: application/json" \
  -d '{"goal":"Send an email to the prospect","payload":{"to":"x@example.com","subject":"Hi","body":"..."}}'

# Approve it (use the task id returned above)
curl -X POST localhost:4000/api/tasks/<id>/approve

curl localhost:4000/api/dashboard/summary
```

## Database

`database/schema.sql` is the real Supabase schema (with pgvector) from the
architecture doc — run it against a Supabase project when ready to persist
data instead of using the in-memory store.
