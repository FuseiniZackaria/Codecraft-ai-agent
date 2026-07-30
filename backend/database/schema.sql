-- CodeCraft AI v1.0 — Supabase / PostgreSQL schema
-- Run against a Supabase project with the pgvector extension enabled.
--
-- Note: task/reflection/audit IDs are generated client-side (uuid v4) by the
-- backend before insert, so `tasks.id` has no server-side default. If you
-- ran an earlier version of this schema with `agent_id`/`action` columns,
-- drop and recreate the `tasks` table using the definition below.

create extension if not exists vector;

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  config jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists tasks (
  id uuid primary key,
  agent text not null,            -- agent registry key, e.g. "research"
  instruction text not null,
  tool_call jsonb,                 -- { tool, irreversible } when the task maps to a plugin action
  payload jsonb,                   -- args for the tool call, supplied by the caller
  status text default 'pending',   -- pending | pending_approval | done | failed | rejected
  irreversible boolean default false,
  result jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  title text,
  pinned boolean default false,
  folder text,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  role text not null, -- user | assistant | system | agent
  content text,
  metadata jsonb,
  created_at timestamptz default now()
);

create table if not exists embeddings (
  id uuid primary key default gen_random_uuid(),
  source_type text,        -- pdf | docx | url | youtube ...
  source_id text,
  chunk text,
  embedding vector(1536),
  metadata jsonb,
  created_at timestamptz default now()
);

create table if not exists whatsapp_messages (
  id text primary key,           -- Meta's message id, used for webhook dedup
  from_number text not null,
  body text,
  created_at timestamptz default now()
);

create table if not exists skills (
  id text primary key,
  name text not null,
  version text not null,
  author text,
  description text,
  manifest jsonb not null,
  permissions jsonb default '[]',
  status text default 'enabled',       -- enabled | disabled
  source_type text,                     -- local | github | zip-url | registry
  source_input text,                     -- the original install string, for re-fetching on update/repair
  source_path text,                     -- where the installed files live on disk
  checksum text,
  installed_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists long_term_memory (
  id uuid primary key,
  fact text not null,
  created_at timestamptz default now()
);

create table if not exists agent_memory (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  entry jsonb,
  created_at timestamptz default now()
);

create table if not exists reflections (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  task_id uuid references tasks(id),
  note text,
  created_at timestamptz default now()
);

create table if not exists plugins (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  version text,
  enabled boolean default false,
  config jsonb default '{}'
);

create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  name text,
  definition jsonb,   -- DAG of steps
  enabled boolean default true,
  created_at timestamptz default now()
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists user_roles (
  user_id uuid references auth.users(id),
  role_id uuid references roles(id),
  primary key (user_id, role_id)
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text,          -- agent name or user id
  action text,
  target text,
  metadata jsonb,
  created_at timestamptz default now()
);

-- Similarity search helper for RAG retrieval
create or replace function match_embeddings(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (id uuid, chunk text, metadata jsonb, similarity float)
language sql stable
as $$
  select id, chunk, metadata, 1 - (embedding <=> query_embedding) as similarity
  from embeddings
  order by embedding <=> query_embedding
  limit match_count;
$$;
