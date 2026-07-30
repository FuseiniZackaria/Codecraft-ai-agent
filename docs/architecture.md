# CodeCraft AI v1.0 — Architecture Document

**Build. Automate. Scale.**

Scope note: this document is the foundational architecture — folder structure, orchestrator/agent design, plugin & skill SDKs, database schema, and memory system. It's the reference the backend skeleton and frontend shell will be built against.

---

## 1. Folder Structure

```
codecraft-ai/
├── frontend/                     # React + Vite app
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/             # API clients
│   │   ├── stores/                # Zustand stores
│   │   └── utils/
│   └── vite.config.js
│
├── backend/
│   ├── core/
│   │   ├── orchestrator/          # AI Core: planning, routing, monitoring
│   │   ├── providers/             # LLM adapters (pluggable - swap providers freely)
│   │   └── router.js              # model selection logic (cost/speed/capability)
│   │
│   ├── agents/
│   │   ├── base/                  # BaseAgent class all agents extend
│   │   ├── ceo/
│   │   ├── research/
│   │   ├── coding/
│   │   ├── marketing/
│   │   ├── sales/
│   │   ├── support/
│   │   ├── social-media/
│   │   ├── project-manager/
│   │   ├── finance/
│   │   ├── hr/
│   │   ├── personal-assistant/
│   │   ├── analytics/
│   │   └── automation/
│   │
│   ├── plugins/                   # gmail, whatsapp, telegram, github, calendar...
│   │   └── <plugin-name>/
│   │       ├── manifest.json
│   │       ├── actions/
│   │       ├── events/
│   │       └── auth.js
│   │
│   ├── skills/                    # lead-gen, coding, seo, content-writing...
│   │   └── <skill-name>/
│   │       ├── skill.json
│   │       └── handlers/
│   │
│   ├── tools/                     # low-level callable functions exposed to agents
│   ├── memory/                    # memory read/write layer over Supabase
│   ├── rag/                       # ingestion, chunking, embeddings, retrieval
│   ├── workflows/                 # workflow engine + saved workflow definitions
│   ├── api/                       # Express routes/controllers
│   ├── database/                  # migrations, schema, seed scripts
│   ├── config/
│   └── tests/
│
└── docs/
```

**Rule:** `core/` never imports directly from `plugins/` or `skills/` — only through the SDK interfaces below. This is what makes features installable/removable without touching core.

---

## 2. AI Orchestrator

Central coordinator, not a chatbot loop. Pipeline per incoming goal:

```
Request → Intent Parse → Task Decomposition → Agent Assignment
   → Model Routing (per task) → Execution (with approval gate if needed)
   → Result Review → Merge/Reconcile → Final Response
```

**Key modules:**
- `orchestrator/planner.js` — breaks a goal into a task graph (DAG), not just a list, so tasks can run in parallel or be dependent.
- `orchestrator/scheduler.js` — assigns tasks to agents based on role match; queues if agent busy.
- `orchestrator/approvalGate.js` — intercepts tasks flagged `irreversible: true` (payments, deletions, publishing) and blocks execution until a human approves via dashboard/notification.
- `orchestrator/monitor.js` — tracks task status, retries failed steps (configurable backoff), logs everything.
- `router.js` — picks LLM provider per task using a scoring function: `score = w1*capability_match + w2*(1/cost) + w3*(1/latency)`, with manual override via config.

**Approval gate example task object:**
```json
{
  "id": "task_193",
  "agent": "finance",
  "action": "stripe.sendPayment",
  "irreversible": true,
  "status": "pending_approval",
  "requested_by": "orchestrator",
  "payload": { "amount": 500, "recipient": "vendor_x" }
}
```

---

## 3. Agent Model

Every agent extends a common `BaseAgent`:

```js
class BaseAgent {
  role;          // e.g. "Research Agent"
  goals;         // array of active objectives
  memory;        // scoped memory interface (short/long term)
  tools;         // tools available to this agent (from plugin registry)
  taskQueue;     // pending tasks assigned by orchestrator

  async plan(task) { }      // break task into steps
  async execute(step) { }   // run a step, calling tools/LLM as needed
  async reflect(result) { } // self-critique, write to reflection memory
  async log(event) { }      // structured logging
}
```

Agents communicate through the orchestrator's message bus (not directly), so any agent-to-agent call is logged and auditable:

```
AgentA.requestHelp(taskId, "sales") → orchestrator routes → AgentB.receive(task)
```

---

## 4. Plugin SDK

A plugin is a self-contained folder with a manifest; the backend auto-discovers plugins at startup by scanning `backend/plugins/*/manifest.json`.

```json
// manifest.json
{
  "name": "gmail",
  "version": "1.0.0",
  "permissions": ["gmail.read", "gmail.send"],
  "auth": { "type": "oauth2", "provider": "google" },
  "actions": ["sendEmail", "readInbox", "searchMessages"],
  "events": ["newEmailReceived"]
}
```

```js
// actions/sendEmail.js
module.exports = {
  name: "sendEmail",
  permission: "gmail.send",
  async run({ to, subject, body }, context) {
    // context.auth gives the plugin its OAuth client
    // returns a result object logged by the orchestrator
  }
};
```

**Loader behavior:** on startup, `pluginLoader.js` scans the plugins directory, validates each manifest, registers its actions into a global `ToolRegistry`, and checks declared permissions against the installing user's RBAC role before activating.

---

## 5. Skill SDK

Skills are higher-level than plugins — they define *how* to solve a problem, often composing multiple tools/plugins.

```json
// skill.json
{
  "name": "lead-generation",
  "version": "1.0.0",
  "requires_tools": ["web.search", "gmail.sendEmail", "crm.saveLead"],
  "agent": "research"
}
```

Skills are installed independently and referenced by agents at runtime; installing one never requires editing agent or core code — the agent just gains access to a new entry in its skill registry.

---

## 6. Memory Architecture

Layered, all backed by Supabase + pgvector:

| Layer | Purpose | Storage |
|---|---|---|
| Short-term | current conversation/task context | in-memory / Redis (optional) |
| Conversation | full chat history | `messages` table |
| Long-term | durable facts about user/business | `long_term_memory` table |
| Semantic/Vector | embeddings for RAG retrieval | `embeddings` table (pgvector) |
| Knowledge graph | entity relationships | `kg_nodes` / `kg_edges` tables |
| Agent memory | per-agent scratchpad | `agent_memory` table |
| Task memory | task history/outcomes | `tasks` table |
| Reflection | self-critique logs | `reflections` table |

Retrieval flow for RAG: `query → embed → pgvector similarity search (top-k) → rerank → inject into prompt context`.

---

## 7. Database Schema (Supabase / PostgreSQL)

Core tables (abbreviated to essential columns):

```sql
-- users & auth handled by Supabase Auth (auth.users)

create table agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  config jsonb default '{}',
  created_at timestamptz default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id),
  parent_task_id uuid references tasks(id),
  action text not null,
  payload jsonb,
  status text default 'pending', -- pending | running | pending_approval | done | failed
  irreversible boolean default false,
  result jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  title text,
  pinned boolean default false,
  folder text,
  created_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  role text not null, -- user | assistant | system | agent
  content text,
  metadata jsonb,
  created_at timestamptz default now()
);

create table embeddings (
  id uuid primary key default gen_random_uuid(),
  source_type text,        -- pdf | docx | url | youtube ...
  source_id text,
  chunk text,
  embedding vector(1536),
  metadata jsonb,
  created_at timestamptz default now()
);

create table plugins (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  version text,
  enabled boolean default false,
  config jsonb default '{}'
);

create table workflows (
  id uuid primary key default gen_random_uuid(),
  name text,
  definition jsonb,   -- DAG of steps
  enabled boolean default true,
  created_at timestamptz default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text,          -- agent name or user id
  action text,
  target text,
  metadata jsonb,
  created_at timestamptz default now()
);
```

RBAC is modeled with a `roles` table + `user_roles` join table; every plugin action checks `permissions` against the caller's role before the `ToolRegistry` executes it.

---

## 8. REST API Surface (high level)

```
POST   /api/orchestrator/goal          # submit a new high-level goal
GET    /api/tasks/:id                  # task status
POST   /api/tasks/:id/approve          # approve pending_approval task
GET    /api/agents                     # list agents + status
POST   /api/conversations              # new chat
POST   /api/conversations/:id/messages # send message (streamed response)
POST   /api/plugins/install
POST   /api/skills/install
POST   /api/workflows                  # create/update workflow
POST   /api/workflows/:id/run
GET    /api/dashboard/summary          # active agents, cost, usage, logs
```

---

## Next steps

This doc is the contract for the two remaining pieces:
1. **Backend skeleton** — real Express server implementing the orchestrator, one agent, one plugin, this schema.
2. **Frontend shell** — dashboard + chat UI matching this API surface.

Say the word when you're ready to move to the backend skeleton.
