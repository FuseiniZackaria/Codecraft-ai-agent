-- 0011 - Content Studio video editor: video jobs (upload -> worker edits ->
-- download) and each business's brand kit. Files themselves live in
-- Cloudflare R2; these tables only hold where they are and what happened.
--
-- Safe to run more than once. Back up first:
--   node backend/scripts/backup-db.js --label=before-0011

create table if not exists video_jobs (
  id              uuid primary key,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid,
  kind            text not null default 'edit',      -- 'edit' | 'test_clip'
  status          text not null default 'uploading', -- uploading | queued | processing | done | failed | canceled | expired
  original_name   text,
  original_key    text,                              -- R2 object key of the untouched original
  original_bytes  bigint,
  content_type    text,
  answers         jsonb not null default '{}',       -- { platform, cta, style, both_formats }
  stage           text,                              -- what the worker is doing now
  progress        integer not null default 0,        -- 0..100
  stage_log       jsonb not null default '[]',       -- [{ stage, message, at }]
  result          jsonb,                             -- { outputs: [...], notes: [...], post: { caption, hashtags }, ... }
  output_bytes    bigint not null default 0,
  error           text,
  attempts        integer not null default 0,
  worker_id       text,
  claimed_at      timestamptz,
  heartbeat_at    timestamptz,
  finished_at     timestamptz,
  expires_at      timestamptz,                       -- files are deleted after this (free-tier storage)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists video_jobs_workspace on video_jobs (workspace_id, created_at desc);
create index if not exists video_jobs_status on video_jobs (status, created_at);

create table if not exists brand_kits (
  workspace_id    uuid primary key references workspaces(id) on delete cascade,
  colors          jsonb not null default '[]',       -- ["#E4572E", "#1B1B1E"]
  font            text,                              -- e.g. "Montserrat"
  voice           text,                              -- how the brand talks, for titles and the post caption
  logo_key        text,                              -- R2 key
  broll           jsonb not null default '[]',       -- [{ key, name, kind: 'image'|'video', bytes }]
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);

-- Same safety net as 0010: nothing readable with the website's public key.
alter table video_jobs enable row level security;
alter table brand_kits enable row level security;

notify pgrst, 'reload schema';
