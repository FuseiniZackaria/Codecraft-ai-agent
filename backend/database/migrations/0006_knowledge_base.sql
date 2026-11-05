-- 0006: Knowledge base and agent tuning (Settings -> General).
--
-- HOW TO RUN
--   1. Back up first. Paid plan: Supabase -> Database -> Backups. Free plan:
--      run `node backend/scripts/backup-db.js --label=pre-0006` on your computer
--      (read-only; saves every table as JSON in backups/, which git ignores).
--   2. Supabase -> SQL Editor -> New query -> paste this whole file -> Run.
--   3. You should see "Success. No rows returned". Safe to run more than once.
--
-- WHAT IT ADDS (one set per workspace = per business/client)
--   agent_instruction_versions  every saved version of the WhatsApp agent's
--                               instructions, example replies and hold reply
--                               (the newest is the one in use; roll back = copy
--                               an old one forward as a new version)
--   kb_qa_entries               question/answer pairs, each with an on/off switch
--   kb_documents                uploaded files (PDF, Word, text, CSV) + status
--   kb_document_chunks          the text pulled out of each file, in small
--                               searchable sections
--   agent_test_messages         the Test chat on the Settings page
--   storage bucket "knowledge-docs" (private) for the original files
--
-- It also copies the WhatsApp agent's current rules (backend/config/
-- whatsapp-voice.md) plus your old "Voice & tone" text into version 1 for every
-- workspace that has WhatsApp connected - so the agent keeps behaving exactly as
-- it does now until you edit it. Nothing existing is changed or deleted.
--
-- Security: the backend uses the service key, which skips row-level security,
-- and checks the workspace itself. RLS below limits direct access to members of
-- the same workspace, ready for when clients log in to edit their own.

begin;

-- ---------------------------------------------------------------------------
-- 1. Agent instructions (versioned)
-- ---------------------------------------------------------------------------
create table if not exists agent_instruction_versions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  version          integer not null,
  agent_name       text not null default 'Ian',
  instructions     text not null,
  examples         jsonb not null default '[]',   -- [{"customer": "...", "reply": "..."}]
  hold_reply       text,                           -- sent when a reply waits for the team
  note             text,                           -- optional "what changed"
  created_by       uuid,                           -- auth user id
  created_by_email text,
  created_at       timestamptz not null default now(),
  unique (workspace_id, version)
);
create index if not exists agent_instruction_versions_ws on agent_instruction_versions (workspace_id, version desc);

-- ---------------------------------------------------------------------------
-- 2. Q&A entries
-- ---------------------------------------------------------------------------
create table if not exists kb_qa_entries (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  question          text not null,
  answer            text not null,
  enabled           boolean not null default true,
  source            text not null default 'manual',  -- manual | correction
  source_message_id text,                            -- the chat reply it corrected, if any
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search            tsvector generated always as
                      (to_tsvector('english', coalesce(question, '') || ' ' || coalesce(answer, ''))) stored
);
create index if not exists kb_qa_entries_ws on kb_qa_entries (workspace_id);
create index if not exists kb_qa_entries_search on kb_qa_entries using gin (search);

-- ---------------------------------------------------------------------------
-- 3. Documents and their searchable sections
-- ---------------------------------------------------------------------------
create table if not exists kb_documents (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  filename      text not null,
  mime_type     text,
  size_bytes    integer,
  storage_path  text,                               -- path in the knowledge-docs bucket
  status        text not null default 'processing', -- processing | ready | failed
  error         text,
  chunk_count   integer not null default 0,
  char_count    integer not null default 0,
  uploaded_by   uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  processed_at  timestamptz
);
create index if not exists kb_documents_ws on kb_documents (workspace_id);

create table if not exists kb_document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references kb_documents(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  chunk_index  integer not null,
  content      text not null,
  search       tsvector generated always as (to_tsvector('english', content)) stored
);
create index if not exists kb_document_chunks_doc on kb_document_chunks (document_id);
create index if not exists kb_document_chunks_ws on kb_document_chunks (workspace_id);
create index if not exists kb_document_chunks_search on kb_document_chunks using gin (search);

-- ---------------------------------------------------------------------------
-- 4. Test chat
-- ---------------------------------------------------------------------------
create table if not exists agent_test_messages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid,
  role         text not null,                 -- customer | agent
  body         text not null,
  meta         jsonb not null default '{}',   -- sources used, held or not, why
  created_at   timestamptz not null default now()
);
create index if not exists agent_test_messages_ws on agent_test_messages (workspace_id, created_at);

-- ---------------------------------------------------------------------------
-- 5. Row-level security: members of the workspace only
-- ---------------------------------------------------------------------------
alter table agent_instruction_versions enable row level security;
alter table kb_qa_entries              enable row level security;
alter table kb_documents               enable row level security;
alter table kb_document_chunks         enable row level security;
alter table agent_test_messages        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['agent_instruction_versions', 'kb_qa_entries', 'kb_documents', 'kb_document_chunks', 'agent_test_messages'] loop
    execute format('drop policy if exists %I on %I', t || '_members', t);
    execute format(
      'create policy %I on %I for all
         using (exists (select 1 from workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid()))
         with check (exists (select 1 from workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid()))',
      t || '_members', t, t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Private storage bucket for uploaded files (only the backend reads it)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('knowledge-docs', 'knowledge-docs', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Version 1 = the WhatsApp agent's current rules, for workspaces that have
--    WhatsApp connected and no saved version yet.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.whatsapp_sessions') is null then
    return;
  end if;
  insert into agent_instruction_versions (workspace_id, version, agent_name, instructions, examples, hold_reply, note)
  select ws.workspace_id, 1, 'Ian',
         $voice$## Who you are
- You are Ian from CodeCraft, CodeCraft's assistant. When it fits, introduce yourself as "Ian from CodeCraft".
- You are NOT the founder, the owner or a staff member, and you never use any other personal name - only "Ian".
- CodeCraft's founder is Zackman. If someone asks who runs CodeCraft or who they're dealing with, say Zackman founded it and you're his assistant.
- If someone asks whether you're a bot, an AI or a real person, be honest: you're CodeCraft's AI assistant, and Zackman or the team can step in whenever they'd like.

## Tone
- Natural, friendly and professional - the way a polite young Ghanaian professional chats on WhatsApp.
- Short: usually 1-3 sentences. No walls of text, no bullet lists, no corporate sales language ("leverage", "solutions", "we are pleased to inform you").
- Warm Ghanaian courtesy. Phrases like "You're welcome", "No problem at all" and "I'll get back to you shortly" fit well.
- Greet by the time of day in Ghana when a conversation starts, e.g. "Good morning, hope you're doing well." The right greeting is given to you below. Don't greet again in the middle of a conversation.
- "Akwaaba" is a nice touch for someone messaging for the very first time - only then.
- Don't overdo slang. Use light Pidgin or Twi only if the customer writes that way first.
- At most ONE question per message.
- Emojis are rare: one at most, usually none.
- No signature, sign-off or "Best regards" at the end - it's a chat, not an email.

## What to say
- Answer what they actually asked first. Mention CodeCraft's services only when it genuinely helps them.
- If someone says "just testing", "hi" or similar, reply briefly and kindly - no pitch.
- General questions (e.g. how AI could help their work) get a short, genuinely helpful answer with one or two concrete ideas, plus one follow-up question.
- Facts about CodeCraft - prices, services, contact details, hours - come ONLY from the business knowledge below. Never invent them.
- Share the phone number, WhatsApp number or website only when they ask for it or they're ready to book.

## When to hold for Zackman
Set "hold" to true (your reply then waits for Zackman as a suggestion) when the message is about:
- pricing, costs or a quote
- agreeing to a deal, a contract or starting work
- a deadline, a delivery date or any promise
- a complaint, or the customer is upset or angry
- something you don't know the answer to
Everything else - greetings, thanks, general questions, enquiries about what CodeCraft does - is answered straight away (hold = false).$voice$
           || case when coalesce(trim(bp.tone), '') <> ''
                   then E'\n\n## Email & outreach tone\n' || trim(bp.tone)
                   else '' end,
         $examples$[
  {
    "customer": "How can I use AI in my business? I'm a teacher",
    "reply": "Good morning! Great question. As a teacher, AI can help you prepare lesson notes, set and mark quizzes, and answer parents' common questions on WhatsApp, saving you hours each week. What takes up most of your time right now?"
  },
  {
    "customer": "just testing",
    "reply": "Good afternoon! Message received loud and clear. I'm here whenever you need anything."
  },
  {
    "customer": "Are you a bot?",
    "reply": "I am - I'm Ian, CodeCraft's AI assistant. If you'd rather speak with Zackman or the team, just say so and I'll pass it on."
  },
  {
    "customer": "Thank you!",
    "reply": "You're welcome! Have a lovely day."
  }
]$examples$::jsonb,
         $hold$Let me check with the team and get back to you shortly.$hold$,
         'Starting version: copied from the WhatsApp agent''s previous rules and your old Voice & tone field'
  from (select distinct workspace_id from whatsapp_sessions where workspace_id is not null) ws
  left join business_profile bp on bp.workspace_id = ws.workspace_id
  where not exists (select 1 from agent_instruction_versions v where v.workspace_id = ws.workspace_id);
end $$;

commit;
