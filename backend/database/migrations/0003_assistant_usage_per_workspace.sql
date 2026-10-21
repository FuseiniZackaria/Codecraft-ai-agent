-- 0003: per-workspace assistant usage (daily cost cap)
--
-- assistant_usage_daily had `day` as its primary key, so there could only be one
-- row per day for the whole app. This makes it one row per (day, workspace) via
-- a text key "<day>:<workspace_id or 'legacy'>".
--
-- RUN THIS BEFORE deploying the matching backend code. Until it runs, the new
-- backend can't save usage (it logs "[assistant.usage] persist failed" and keeps
-- counting in memory) - nothing else breaks.
--
-- Idempotent and transactional.

begin;

alter table assistant_usage_daily add column if not exists usage_key text;

update assistant_usage_daily
   set usage_key = day || ':' || coalesce(workspace_id::text, 'legacy')
 where usage_key is null;

alter table assistant_usage_daily alter column usage_key set not null;

-- Swap the primary key from (day) to (usage_key).
alter table assistant_usage_daily drop constraint if exists assistant_usage_daily_pkey;
alter table assistant_usage_daily add primary key (usage_key);

commit;

-- Verify: every row has a key, and no two rows share one.
-- select count(*) as rows, count(distinct usage_key) as keys from assistant_usage_daily;
