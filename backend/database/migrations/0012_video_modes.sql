-- 0012 - Video editor modes: "edit my video my way" (a plan you approve) and
-- "make a video of my website" (explore -> plan you approve -> record).
--
-- Login details for websites are NEVER stored here (they stay encrypted in
-- memory only). Safe to run more than once. Back up first:
--   node backend/scripts/backup-db.js --label=before-0012

alter table video_jobs add column if not exists mode text not null default 'auto';  -- 'auto' | 'custom' | 'website'
alter table video_jobs add column if not exists phase text not null default 'edit';  -- 'edit' | 'plan' | 'render'
alter table video_jobs add column if not exists request jsonb not null default '{}'; -- description, website link, voice... (never passwords)
alter table video_jobs add column if not exists plan jsonb;                           -- the plan shown for approval
alter table video_jobs add column if not exists approved_at timestamptz;

notify pgrst, 'reload schema';
