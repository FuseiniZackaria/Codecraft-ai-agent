-- 0009: Onboarding - the welcome screen, setup checklist and guided tour.
--
-- HOW TO RUN
--   1. Back up first (free plan: `node backend/scripts/backup-db.js --label=pre-0009`).
--   2. Supabase -> SQL Editor -> New query -> paste this whole file -> Run.
--   3. You should see "Success. No rows returned". Safe to run more than once.
--
-- WHAT IT ADDS (one row per workspace = per business)
--   workspace_onboarding  whether the welcome screen was seen, which checklist
--                         steps were skipped, whether the checklist is hidden,
--                         and which people have seen the tour (each person
--                         sees it once). Whether a step is DONE is not stored -
--                         it's worked out from the real data (profile, Q&A...).
-- Nothing existing is changed.

begin;

create table if not exists workspace_onboarding (
  workspace_id       uuid primary key references workspaces(id) on delete cascade,
  welcome_seen_at    timestamptz,
  skipped            text[] not null default '{}',   -- checklist step keys skipped for now
  checklist_hidden   boolean not null default false,
  tour_seen_by       uuid[] not null default '{}',   -- user ids who have seen (or skipped) the tour
  updated_at         timestamptz not null default now()
);

alter table workspace_onboarding enable row level security;
drop policy if exists workspace_onboarding_members on workspace_onboarding;
create policy workspace_onboarding_members on workspace_onboarding for all
  using (exists (select 1 from workspace_members wm where wm.workspace_id = workspace_onboarding.workspace_id and wm.user_id = auth.uid()))
  with check (exists (select 1 from workspace_members wm where wm.workspace_id = workspace_onboarding.workspace_id and wm.user_id = auth.uid()));

commit;
