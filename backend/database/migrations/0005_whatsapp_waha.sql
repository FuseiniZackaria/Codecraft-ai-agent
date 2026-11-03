-- 0005: WhatsApp through WAHA (self-hosted), plus one message format for WAHA and Twilio.
--
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once. Until it runs, WhatsApp replies still work but
-- messages aren't saved for the Inbox and the WAHA connect button can't save
-- the session.
--
-- Note: the older table "whatsapp_messages" (id, from_number, body) is a
-- different, pre-existing de-duplication table and is left untouched.

begin;

-- One WAHA session per admin (session_name is built from the admin's user id).
create table if not exists whatsapp_sessions (
  session_name          text primary key,
  user_id               uuid not null unique,
  workspace_id          uuid,
  status                text not null default 'STOPPED',   -- STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED
  phone_number          text,                              -- connected number, e.g. 233241234567
  push_name             text,
  needs_reconnect       boolean not null default false,    -- drives the "Reconnect" banner
  disconnected_by_user  boolean not null default false,
  last_error            text,
  last_status_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Every incoming and outgoing WhatsApp message, the same shape for WAHA and Twilio.
create table if not exists whatsapp_chat_messages (
  id              uuid primary key,
  provider        text not null,                -- 'waha' | 'twilio'
  session_name    text,
  user_id         uuid,                         -- the admin whose WhatsApp it is (null for workspace-level Twilio)
  workspace_id    uuid,
  direction       text not null check (direction in ('in', 'out')),
  contact_number  text not null,                -- country code, no + or leading 0: 233241234567
  contact_name    text,
  body            text not null default '',
  wa_message_id   text,                         -- provider's message id (de-duplicates webhook retries)
  source          text,                         -- contact | auto_reply | manual | outreach | agent
  sent_at         timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create unique index if not exists whatsapp_chat_messages_wa_id on whatsapp_chat_messages (wa_message_id) where wa_message_id is not null;
create index if not exists whatsapp_chat_messages_user_contact on whatsapp_chat_messages (user_id, contact_number, sent_at desc);
create index if not exists whatsapp_chat_messages_workspace on whatsapp_chat_messages (workspace_id, sent_at desc);

-- Outreach send queue (sent one at a time per session, 30-90s apart, DAILY_WA_LIMIT per day).
create table if not exists whatsapp_outbox (
  id              uuid primary key,
  session_name    text not null,
  user_id         uuid,
  workspace_id    uuid,
  contact_number  text not null,
  body            text not null,
  status          text not null default 'queued',  -- queued | sending | sent | failed | skipped
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists whatsapp_outbox_queue on whatsapp_outbox (status, created_at);
create index if not exists whatsapp_outbox_sent on whatsapp_outbox (session_name, status, sent_at);

-- Contacts who replied "stop": outreach skips them.
create table if not exists whatsapp_optouts (
  session_name    text not null,
  contact_number  text not null,
  reason          text,
  created_at      timestamptz not null default now(),
  primary key (session_name, contact_number)
);

-- Only the backend (service role key) reads these. With RLS on and no
-- policies, the public anon key used by the browser can't read them at all.
alter table whatsapp_sessions      enable row level security;
alter table whatsapp_chat_messages enable row level security;
alter table whatsapp_outbox        enable row level security;
alter table whatsapp_optouts       enable row level security;

commit;

-- Check it worked (should list 4 tables):
-- select table_name from information_schema.tables
--  where table_name in ('whatsapp_sessions','whatsapp_chat_messages','whatsapp_outbox','whatsapp_optouts');
