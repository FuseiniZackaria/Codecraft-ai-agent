-- 0014 - Computer Helper: each person connects THEIR OWN computer, and the
-- Computer Operator agent acts only on the computer of the person asking.
-- The helper (a small program on that person's PC) keeps the list of shared
-- folders and apps itself; these tables only record which computers are
-- connected and what was done on them.
--
-- Safe to run more than once. Back up first:
--   node backend/scripts/backup-db.js --label=before-0014

create table if not exists computer_devices (
  id               uuid primary key,
  user_id          uuid not null,                     -- the ONLY person whose requests reach this computer
  workspace_id     uuid,
  name             text,                              -- e.g. the PC's name, shown on the page
  status           text not null default 'pending',   -- pending (code not used yet) | active | revoked
  pair_code_hash   text,                              -- sha256 of the one-time connect code
  pair_expires_at  timestamptz,
  token_hash       text unique,                       -- sha256 of the helper's secret; the secret itself is never stored
  roots            jsonb not null default '[]',       -- shared folders, as reported by the helper (display only)
  apps             jsonb not null default '[]',       -- allowed app names, as reported by the helper (display only)
  paused           boolean not null default false,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz
);
create index if not exists computer_devices_user on computer_devices (user_id, status);

-- One row per action sent to a computer: the queue AND the person's activity log.
create table if not exists computer_jobs (
  id           uuid primary key,
  device_id    uuid not null references computer_devices(id) on delete cascade,
  user_id      uuid not null,
  op           text not null,
  args         jsonb not null default '{}',
  summary      text,                                  -- short, human-readable ("Searched for 'invoice'")
  status       text not null default 'queued',        -- queued | running | done | failed | expired
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists computer_jobs_device_status on computer_jobs (device_id, status, created_at);
create index if not exists computer_jobs_user_created on computer_jobs (user_id, created_at);

-- Only the backend (service key) reads or writes these.
alter table computer_devices enable row level security;
alter table computer_jobs enable row level security;
