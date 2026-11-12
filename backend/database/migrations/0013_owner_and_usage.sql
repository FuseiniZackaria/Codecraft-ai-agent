-- 0013 - The "owner" role, per-admin API usage tracking and monthly caps.
-- Safe to run more than once. Back up first:
--   node backend/scripts/backup-db.js --label=before-0013
-- Then make your own account the owner with 0013b_make_me_owner.sql.

-- 1. The owner role: everything an admin can do, plus owner-only features.
insert into roles (name)
select 'owner' where not exists (select 1 from roles where name = 'owner');

-- There must always be at least one owner: the last owner's role can't be removed.
create or replace function keep_one_owner() returns trigger as $$
declare owner_role_id roles.id%type;
begin
  select id into owner_role_id from roles where name = 'owner';
  if old.role_id = owner_role_id
     and (select count(*) from user_roles where role_id = owner_role_id and user_id <> old.user_id) = 0 then
    raise exception 'There must always be at least one owner.';
  end if;
  return old;
end;
$$ language plpgsql;
drop trigger if exists keep_one_owner_tr on user_roles;
create trigger keep_one_owner_tr before delete on user_roles for each row execute function keep_one_owner();

-- 2. One row per real AI call (estimated cost). user_id null = automated work.
create table if not exists api_usage (
  id             bigint generated always as identity primary key,
  user_id        uuid,
  user_email     text,
  agent          text,
  task_id        text,
  provider       text,
  model          text,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd       numeric(12, 6) not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists api_usage_user_created on api_usage (user_id, created_at);
create index if not exists api_usage_created on api_usage (created_at);

-- 3. Monthly caps (calendar month, UTC). monthly_cap_usd null = no cap.
-- user_id 00000000-0000-0000-0000-000000000000 = the "automated" bucket (scheduler, webhooks).
create table if not exists usage_caps (
  user_id          uuid primary key,
  monthly_cap_usd  numeric(12, 2),
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);

-- 4. Totals computed in the database (group by), never by sending every row.
create or replace function api_usage_month_total(p_user uuid, p_from timestamptz)
returns numeric language sql stable as $$
  select coalesce(sum(cost_usd), 0) from api_usage
  where created_at >= p_from and (user_id = p_user or (p_user is null and user_id is null));
$$;

create or replace function api_usage_summary(p_from timestamptz)
returns table (user_id uuid, user_email text, agent text, month text, cost_usd numeric, input_tokens bigint, output_tokens bigint, calls bigint)
language sql stable as $$
  select user_id, max(user_email), agent, to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM'),
         sum(cost_usd), sum(input_tokens), sum(output_tokens), count(*)
  from api_usage where created_at >= p_from
  group by user_id, agent, date_trunc('month', created_at at time zone 'UTC');
$$;

-- Only the backend (service key) may use these.
revoke all on function api_usage_month_total(uuid, timestamptz) from public, anon, authenticated;
revoke all on function api_usage_summary(timestamptz) from public, anon, authenticated;

-- 5. Row level security ON, no policies: the website's public key can't read or write them.
alter table api_usage enable row level security;
alter table usage_caps enable row level security;

notify pgrst, 'reload schema';
