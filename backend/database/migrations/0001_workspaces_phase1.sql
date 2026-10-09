-- ============================================================================
-- CodeCraft AI - Workspaces Phase 1 (schema + backfill + shadow-mode RLS)
--
-- Review BEFORE running. Everything here is additive and idempotent:
--   - Only CREATE / ADD COLUMN / INSERT - no DROP, no DELETE, no UPDATE
--     against existing data except the one well-defined backfill below.
--   - Every statement uses "IF NOT EXISTS" or guarded WHERE clauses so this
--     file is safe to re-run after a partial failure.
--
-- WHAT THIS DOES
--   1. Adds workspaces / workspace_members / workspace_connections /
--      business_profile - the new per-tenant containers.
--   2. Adds a nullable workspace_id uuid column to every admin-owned table
--      (tasks, chat_messages, audit_log, outreach_threads, scheduled_workflows,
--      workflow_definitions, workflow_runs, briefing_runs, briefing_articles,
--      agent_memory, long_term_memory, reflections, skills, assistant_usage_daily).
--   3. Creates one workspace named "Fuseini's workspace" owned by the current
--      sole admin (resolved by email from env), and backfills every existing
--      row to that workspace. Idempotent: once rows are stamped, re-running
--      is a no-op.
--   4. Turns on RLS for the FOUR NEW user-facing tables with real policies
--      (owner / member scoped). RLS is NOT enabled on the 14 altered tables
--      yet - that is Phase 2. Backend keeps enforcing by filtering on
--      workspace_id in SupabaseStore wrappers during the shadow window.
--   5. Adds a rls_shadow_log table + per-write triggers on the altered tables
--      so any INSERT/UPDATE that lands with a workspace_id different from
--      the Postgres session setting `app.workspace_id` is logged (never
--      blocked). You read this log to confirm Phase 2 can safely enforce.
--
-- WHAT THIS DOES NOT DO
--   - Does NOT delete or move existing data.
--   - Does NOT enable enforcing RLS on tasks / chat_messages / etc.
--   - Does NOT change any application behavior - the backend still reads
--     and writes exactly as it does today until the Phase 2 code lands.
--
-- SAFETY CHECKLIST BEFORE RUNNING
--   - Supabase: take a database snapshot (Database -> Backups -> New backup).
--   - Confirm you are the only admin currently (SELECT count(*) FROM user_roles).
--   - Set the SQL variable below to your admin email so the backfill picks
--     the right owner. If left blank, the backfill picks the oldest admin
--     by auth.users.created_at.
--
-- RUN IN
--   Supabase SQL Editor -> New query -> paste -> Run. Expect "Success. No
--   rows returned." and no errors.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Owner selection input. Change the DEFAULT or leave as '' to use fallback.
--    This is only used by the one-time backfill below; it has no runtime
--    effect afterwards.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'cc_workspaces_phase1_meta') then
    create type cc_workspaces_phase1_meta as (owner_email text, workspace_name text);
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 1. Core new tables
-- ---------------------------------------------------------------------------
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspaces_owner_name_uidx
  on workspaces (owner_user_id, name);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',          -- owner | member (invitations are a later phase)
  invited_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on workspace_members (user_id);

create table if not exists workspace_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,                       -- 'gmail' | 'googlecalendar' | 'github' | 'reddit' | 'whatsapp' | 'telegram' | ...
  -- One of these two is populated depending on provider:
  composio_account_id text,                     -- for Composio-brokered providers (Gmail / Calendar / GitHub / Reddit)
  provider_meta jsonb not null default '{}',    -- phone_number_id, bot_token_ref, webhook_secret_ref, etc. - never the raw token itself.
  -- Tokens for non-Composio providers are stored by reference (Supabase Vault
  -- secret id or an env var name), never as plaintext in this row. Column is
  -- deliberately absent until a reference storage layer exists.
  status text not null default 'connected',    -- connected | disconnected | failed
  connected_email text,                         -- the connected Gmail account's address, when known - used for the "my own emails" skip list
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_connections_one_per_provider_uidx
  on workspace_connections (workspace_id, provider);

create index if not exists workspace_connections_workspace_idx
  on workspace_connections (workspace_id);

create table if not exists business_profile (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  display_name text,                            -- e.g. "Fuseini Zackaria"
  business_name text,
  title text,                                   -- e.g. "AI Software Engineer"
  business_email text,                          -- the "from" / reply-to the admin wants used
  extra_email_addresses jsonb not null default '[]',  -- array of strings; populates the inbox-triage skip list
  phone text,
  whatsapp text,
  website text,
  location text,
  offers text,                                  -- short "what we sell / what we can do" paragraph used in outreach prompts
  signature text,                               -- email signature block
  tone text,                                    -- e.g. "warm, direct, Ghanaian small-business tone"
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 2. ADD COLUMN workspace_id to every admin-owned table.
--    Nullable for now, backfilled below, tightened in Phase 2.
-- ---------------------------------------------------------------------------
alter table tasks                 add column if not exists workspace_id uuid references workspaces(id);
alter table chat_messages         add column if not exists workspace_id uuid references workspaces(id);
alter table audit_log             add column if not exists workspace_id uuid references workspaces(id);
alter table outreach_threads      add column if not exists workspace_id uuid references workspaces(id);
alter table scheduled_workflows   add column if not exists workspace_id uuid references workspaces(id);
alter table workflow_definitions  add column if not exists workspace_id uuid references workspaces(id);
alter table workflow_runs         add column if not exists workspace_id uuid references workspaces(id);
alter table briefing_runs         add column if not exists workspace_id uuid references workspaces(id);
alter table briefing_articles     add column if not exists workspace_id uuid references workspaces(id);
alter table agent_memory          add column if not exists workspace_id uuid references workspaces(id);
alter table long_term_memory      add column if not exists workspace_id uuid references workspaces(id);
alter table reflections           add column if not exists workspace_id uuid references workspaces(id);
alter table skills                add column if not exists workspace_id uuid references workspaces(id);
alter table assistant_usage_daily add column if not exists workspace_id uuid references workspaces(id);

create index if not exists tasks_workspace_idx                on tasks                (workspace_id);
create index if not exists chat_messages_workspace_idx        on chat_messages        (workspace_id);
create index if not exists audit_log_workspace_idx            on audit_log            (workspace_id);
create index if not exists outreach_threads_workspace_idx     on outreach_threads     (workspace_id);
create index if not exists scheduled_workflows_workspace_idx  on scheduled_workflows  (workspace_id);
create index if not exists workflow_definitions_workspace_idx on workflow_definitions (workspace_id);
create index if not exists workflow_runs_workspace_idx        on workflow_runs        (workspace_id);
create index if not exists briefing_runs_workspace_idx        on briefing_runs        (workspace_id);
create index if not exists briefing_articles_workspace_idx    on briefing_articles    (workspace_id);
create index if not exists agent_memory_workspace_idx         on agent_memory         (workspace_id);
create index if not exists long_term_memory_workspace_idx     on long_term_memory     (workspace_id);
create index if not exists reflections_workspace_idx          on reflections          (workspace_id);
create index if not exists skills_workspace_idx               on skills               (workspace_id);


-- ---------------------------------------------------------------------------
-- 3. Backfill: create "Fuseini's workspace" and stamp every pre-existing row.
--    Idempotent - if the workspace already exists, this block is a no-op.
--    Owner is picked by:
--      a) the owner_email you edit in the first SELECT below, OR
--      b) the oldest admin (user_roles joined to roles.name='admin').
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner_email  text := 'stillzackman@gmail.com';   -- <<< OPTIONAL: paste your admin email between the quotes
  v_workspace_name text := 'Fuseini''s workspace';
  v_owner_id     uuid;
  v_workspace_id uuid;
begin
  -- Resolve owner
  if v_owner_email <> '' then
    select id into v_owner_id from auth.users where lower(email) = lower(v_owner_email) limit 1;
  end if;
  if v_owner_id is null then
    select ur.user_id into v_owner_id
    from user_roles ur
    join roles r on r.id = ur.role_id and r.name = 'admin'
    join auth.users u on u.id = ur.user_id
    order by u.created_at asc
    limit 1;
  end if;

  if v_owner_id is null then
    raise notice 'No admin found - skipping backfill. Add an admin first, then re-run this file.';
    return;
  end if;

  -- Create or find the workspace (unique on owner_user_id + name)
  insert into workspaces (name, owner_user_id)
  values (v_workspace_name, v_owner_id)
  on conflict (owner_user_id, name) do nothing;

  select id into v_workspace_id
  from workspaces
  where owner_user_id = v_owner_id and name = v_workspace_name;

  -- Owner membership
  insert into workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_owner_id, 'owner')
  on conflict do nothing;

  -- Business profile skeleton (user fills via UI later)
  insert into business_profile (workspace_id)
  values (v_workspace_id)
  on conflict (workspace_id) do nothing;

  -- Stamp every row that doesn't already have a workspace_id.
  update tasks                 set workspace_id = v_workspace_id where workspace_id is null;
  update chat_messages         set workspace_id = v_workspace_id where workspace_id is null;
  update audit_log             set workspace_id = v_workspace_id where workspace_id is null;
  update outreach_threads      set workspace_id = v_workspace_id where workspace_id is null;
  update scheduled_workflows   set workspace_id = v_workspace_id where workspace_id is null;
  update workflow_definitions  set workspace_id = v_workspace_id where workspace_id is null;
  update workflow_runs         set workspace_id = v_workspace_id where workspace_id is null;
  update briefing_runs         set workspace_id = v_workspace_id where workspace_id is null;
  update briefing_articles     set workspace_id = v_workspace_id where workspace_id is null;
  update agent_memory          set workspace_id = v_workspace_id where workspace_id is null;
  update long_term_memory      set workspace_id = v_workspace_id where workspace_id is null;
  update reflections           set workspace_id = v_workspace_id where workspace_id is null;
  update skills                set workspace_id = v_workspace_id where workspace_id is null;
  update assistant_usage_daily set workspace_id = v_workspace_id where workspace_id is null;

  raise notice 'Backfill complete. Workspace id = %', v_workspace_id;
end $$;


-- ---------------------------------------------------------------------------
-- 4. RLS - enabled with real policies on the FOUR new user-facing tables.
--    The service-key backend bypasses RLS, so these policies only ever apply
--    to any direct supabase-js call made with the admin's own JWT (e.g. a
--    future client-side read of their own business_profile).
--
--    RLS stays OFF on the 14 altered tables for Phase 1 ("shadow mode").
--    Enforcement there is the job of Phase 2, after shadow logs are clean.
-- ---------------------------------------------------------------------------
alter table workspaces           enable row level security;
alter table workspace_members    enable row level security;
alter table workspace_connections enable row level security;
alter table business_profile     enable row level security;

-- Members can read their workspaces; owners can update them.
drop policy if exists workspaces_select on workspaces;
create policy workspaces_select on workspaces for select
  using (exists (select 1 from workspace_members wm
                 where wm.workspace_id = workspaces.id and wm.user_id = auth.uid()));

drop policy if exists workspaces_update_owner on workspaces;
create policy workspaces_update_owner on workspaces for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- workspace_members: members see their own rows; the workspace owner can manage.
drop policy if exists workspace_members_select on workspace_members;
create policy workspace_members_select on workspace_members for select
  using (user_id = auth.uid()
      or exists (select 1 from workspaces w
                 where w.id = workspace_members.workspace_id and w.owner_user_id = auth.uid()));

drop policy if exists workspace_members_write_owner on workspace_members;
create policy workspace_members_write_owner on workspace_members for all
  using (exists (select 1 from workspaces w
                 where w.id = workspace_members.workspace_id and w.owner_user_id = auth.uid()))
  with check (exists (select 1 from workspaces w
                 where w.id = workspace_members.workspace_id and w.owner_user_id = auth.uid()));

-- workspace_connections / business_profile: any member can read/write.
drop policy if exists workspace_connections_rw on workspace_connections;
create policy workspace_connections_rw on workspace_connections for all
  using (exists (select 1 from workspace_members wm
                 where wm.workspace_id = workspace_connections.workspace_id and wm.user_id = auth.uid()))
  with check (exists (select 1 from workspace_members wm
                 where wm.workspace_id = workspace_connections.workspace_id and wm.user_id = auth.uid()));

drop policy if exists business_profile_rw on business_profile;
create policy business_profile_rw on business_profile for all
  using (exists (select 1 from workspace_members wm
                 where wm.workspace_id = business_profile.workspace_id and wm.user_id = auth.uid()))
  with check (exists (select 1 from workspace_members wm
                 where wm.workspace_id = business_profile.workspace_id and wm.user_id = auth.uid()));


-- ---------------------------------------------------------------------------
-- 5. Shadow-mode logging for the 14 altered tables.
--    PostgreSQL doesn't support BEFORE SELECT triggers, so this phase only
--    logs INSERT / UPDATE / DELETE with mismatched workspace. The backend's
--    SELECT paths will be shadow-logged at the application layer during
--    Phase 2 (SupabaseStore wrapper counts and logs reads without a
--    workspace_id filter).
--
--    The session variable `app.workspace_id` is read by this trigger. The
--    backend sets it per request in Phase 2. For now (no setter), the
--    trigger simply writes nothing - which is correct shadow-mode behavior:
--    only log once we have something real to compare against.
-- ---------------------------------------------------------------------------
create table if not exists rls_shadow_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  operation text not null,                       -- INSERT | UPDATE | DELETE
  row_workspace_id uuid,
  session_workspace_id uuid,
  at timestamptz not null default now()
);

create or replace function rls_shadow_log_fn() returns trigger as $$
declare
  v_session_ws uuid;
  v_row_ws uuid;
begin
  begin
    v_session_ws := nullif(current_setting('app.workspace_id', true), '')::uuid;
  exception when others then
    v_session_ws := null;
  end;

  if tg_op = 'DELETE' then
    v_row_ws := old.workspace_id;
  else
    v_row_ws := new.workspace_id;
  end if;

  -- Shadow mode: log only when we have both ids and they disagree.
  if v_session_ws is not null and v_row_ws is not null and v_session_ws <> v_row_ws then
    insert into rls_shadow_log (table_name, operation, row_workspace_id, session_workspace_id)
    values (tg_table_name, tg_op, v_row_ws, v_session_ws);
  end if;

  return coalesce(new, old);
end;
$$ language plpgsql;

do $$
declare
  tbl text;
  tbls text[] := array[
    'tasks','chat_messages','audit_log','outreach_threads','scheduled_workflows',
    'workflow_definitions','workflow_runs','briefing_runs','briefing_articles',
    'agent_memory','long_term_memory','reflections','skills','assistant_usage_daily'
  ];
begin
  foreach tbl in array tbls loop
    execute format($f$
      drop trigger if exists %I_rls_shadow_tr on %I;
      create trigger %I_rls_shadow_tr
        after insert or update or delete on %I
        for each row execute function rls_shadow_log_fn();
    $f$, tbl, tbl, tbl, tbl);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 6. Verification. These SELECTs don't write anything - run them after this
--    file to confirm the migration applied cleanly.
-- ---------------------------------------------------------------------------
--   select 'tasks' as t, count(*) as rows, count(workspace_id) as stamped from tasks
--   union all select 'chat_messages', count(*), count(workspace_id) from chat_messages
--   union all select 'audit_log', count(*), count(workspace_id) from audit_log;
--
--   select * from workspaces;
--   select * from business_profile;
--
--   select table_name, operation, count(*) from rls_shadow_log
--   group by 1,2 order by 1,2;