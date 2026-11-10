-- 0010 - Multi-client WhatsApp: each client business gets its own settings,
-- warm-up for newly linked numbers, Meta templates and opt-ins, and a
-- database safety net (row level security on every table).
--
-- Safe to run more than once. Back up first:
--   node backend/scripts/backup-db.js --label=before-0010

-- 1. Per-client WhatsApp settings (Settings -> Clients, Settings -> WhatsApp).
create table if not exists whatsapp_client_settings (
  workspace_id        uuid primary key references workspaces(id) on delete cascade,
  tier                text not null default 'reply_only',  -- 'reply_only' (Tier 1, WAHA) | 'outreach'
  channel             text not null default 'waha',        -- 'waha' (linked phone) | 'meta' (official Cloud API)
  auto_reply          boolean,                             -- null = the server default (WA_AUTO_REPLY)
  alert_number        text,                                -- where THIS business's alerts go on WhatsApp
  place               text,                                -- town for "good morning / evening" (null = WA_PLACE or Ghana)
  language            text not null default 'match',       -- 'english' | 'match' | 'local'
  daily_reply_limit   integer,                             -- automatic replies per day from this number (null = AUTO_REPLY_DAILY_LIMIT)
  warmup_days         integer not null default 14,         -- lower outreach limits for this many days after linking
  meta_templates      jsonb not null default '[]',         -- [{ name, language, params, body }] approved on Meta
  updated_at          timestamptz not null default now(),
  updated_by          uuid
);
alter table whatsapp_client_settings drop constraint if exists whatsapp_client_settings_tier_check;
alter table whatsapp_client_settings add constraint whatsapp_client_settings_tier_check check (tier in ('reply_only', 'outreach'));
alter table whatsapp_client_settings drop constraint if exists whatsapp_client_settings_channel_check;
alter table whatsapp_client_settings add constraint whatsapp_client_settings_channel_check check (channel in ('waha', 'meta'));
alter table whatsapp_client_settings drop constraint if exists whatsapp_client_settings_language_check;
alter table whatsapp_client_settings add constraint whatsapp_client_settings_language_check check (language in ('english', 'match', 'local'));

-- 2. Sessions: when this number was linked (warm-up), and when its loss was last alerted.
alter table whatsapp_sessions add column if not exists linked_at timestamptz;
alter table whatsapp_sessions add column if not exists lost_alerted_at timestamptz;
create index if not exists whatsapp_sessions_workspace on whatsapp_sessions (workspace_id);

-- 3. Outbox: a Meta template to send instead of free text.
alter table whatsapp_outbox add column if not exists template jsonb;
create index if not exists whatsapp_outbox_session_created on whatsapp_outbox (session_name, created_at desc);

-- 4. Opt-ins for Meta outreach: people who agreed to get WhatsApp messages from this business.
create table if not exists whatsapp_consent (
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  contact_number  text not null,
  source          text,          -- 'import' | 'start' | ...
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  primary key (workspace_id, contact_number)
);

-- Faster per-number counts (daily reply limit, 24-hour window).
create index if not exists whatsapp_chat_messages_session_dir on whatsapp_chat_messages (session_name, direction, sent_at desc);

-- 5. Safety net: row level security ON for every table in the public schema.
-- The backend uses the service key, which is not affected. Anyone holding the
-- PUBLIC (anon) key from the website - or a signed-in user's token - can no
-- longer read or change any table directly through Supabase's API.
-- Check it afterwards with: node backend/scripts/check-rls.js
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

notify pgrst, 'reload schema';
