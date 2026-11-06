-- 0008: Leads (Work -> Leads) - every WhatsApp contact becomes a lead; Ian
-- fills in what he learns; follow-ups and a daily summary.
--
-- HOW TO RUN
--   1. Back up first (free plan: `node backend/scripts/backup-db.js --label=pre-0008`).
--   2. Supabase -> SQL Editor -> New query -> paste this whole file -> Run.
--   3. You should see "Success. No rows returned". Safe to run more than once.
--
-- WHAT IT ADDS (per workspace = per business)
--   leads          one row per person: what Ian learned, status, AI summary,
--                  your notes, follow-up counters. Source 'whatsapp' (people who
--                  messaged you) or 'scraped' (your notes/status on a Google Sheet
--                  lead - the Sheet itself is never changed and is never messaged).
--   lead_settings  follow-up timing, "ask me before sending follow-ups" (on),
--                  daily summary on/off and time.
-- Nothing existing is changed.

begin;

create table if not exists leads (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  source            text not null default 'whatsapp',   -- whatsapp | scraped
  external_key      text,                               -- scraped: email/phone/name from the Sheet
  session_name      text,                               -- WhatsApp: the linked number it came in on
  user_id           uuid,                               -- WhatsApp: admin who owns that number
  contact_number    text,                               -- WhatsApp number (digits)
  contact_name      text,                               -- their WhatsApp display name
  name              text,                               -- name they gave
  business_type     text,
  need              text,                               -- website | ecommerce | design | ai_assistant | seo | other
  budget            text,
  timeline          text,
  location          text,
  status            text not null default 'new',        -- new | interested | quote_sent | won | lost | not_interested
  status_set_by     text not null default 'ian',        -- ian | owner (Ian never overrides the owner's won/lost)
  summary           text,                               -- short AI summary of the chat
  notes             text,                               -- the owner's notes
  last_message_at   timestamptz,
  last_inbound_at   timestamptz,
  last_outbound_at  timestamptz,
  followups_sent    integer not null default 0,         -- never more than 2
  last_followup_at  timestamptz,
  hot_alerted_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists leads_whatsapp_uidx on leads (workspace_id, contact_number) where source = 'whatsapp';
create unique index if not exists leads_scraped_uidx on leads (workspace_id, external_key) where source = 'scraped';
create index if not exists leads_ws on leads (workspace_id, last_message_at desc);

create table if not exists lead_settings (
  workspace_id           uuid primary key references workspaces(id) on delete cascade,
  followups_enabled      boolean not null default true,
  ask_before_followup    boolean not null default true,  -- follow-ups wait for your approval
  first_followup_days    integer not null default 2,
  second_followup_days   integer not null default 5,
  daily_summary          boolean not null default true,
  summary_hour           integer not null default 19,    -- Ghana time, 0-23
  last_summary_on        date,
  updated_at             timestamptz not null default now()
);

alter table leads         enable row level security;
alter table lead_settings enable row level security;
do $$
declare t text;
begin
  foreach t in array array['leads', 'lead_settings'] loop
    execute format('drop policy if exists %I on %I', t || '_members', t);
    execute format(
      'create policy %I on %I for all
         using (exists (select 1 from workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid()))
         with check (exists (select 1 from workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid()))',
      t || '_members', t, t, t);
  end loop;
end $$;

commit;
