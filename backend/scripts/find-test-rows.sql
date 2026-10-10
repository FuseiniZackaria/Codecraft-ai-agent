-- =====================================================================
-- Diagnostic: list rows that look like test fixtures leaked into the
-- real database. SELECT-only. Nothing is deleted.
-- Run in the Supabase SQL Editor against your production project.
-- =====================================================================
--
-- How rows are identified as test fixtures:
--   1. ID matches a hard-coded fixture id used by a specific test file
--      (e.g. 'wf-full-test' in workflow-engine.test.js, 'analytics-wf1'
--      in analytics.test.js). These IDs only appear in test code.
--   2. Name matches a test-only label ('Full test', 'Safety test',
--      'Loop list', etc.) that no genuine user workflow would carry.
--   3. Goal matches a test-only payload ('Research something',
--      'Research competitor pricing' from self-prompting.test.js).
--   4. For long_term_memory, facts prefixed with 'test' or 'sanity-test'
--      (added by business-profile-chat.test.js and friends).
--
-- Review the output. Decide which rows to disable or delete yourself.
-- Separate query at the bottom disables (NOT deletes) any still-enabled
-- test workflows that could fire on the scheduler right now.
-- =====================================================================


-- 1. scheduled_workflows ----------------------------------------------
--    Hard-coded test IDs from scheduler.test.js, and the "Manual test"
--    workflow that gets saved by its "run-now" check. "Gmail auto-triage
--    (migrated)" is created by scheduler.migrateLegacyGmailTriage during
--    the test's call to scheduler.start() when GMAIL_TRIAGE_INTERVAL_MINUTES=15
--    is set in the test harness - a real user-created workflow would not
--    carry that exact migrated-note name.
select
  'scheduled_workflows'               as table_name,
  id,
  name,
  goal,
  enabled,
  schedule_type                       as schedule,
  interval_minutes,
  last_run_at,
  workspace_id,
  created_at
from scheduled_workflows
where
  id in ('test-wf-crud', 'test-wf-manual')
  or name in ('Test', 'Manual test', 'Gmail auto-triage (migrated)')
  or goal = 'Research something'
order by created_at desc;


-- 2. workflow_definitions ---------------------------------------------
--    Hard-coded test IDs from workflow-engine, workflow-engine-phase2,
--    workflow-marketplace, self-prompting, folder-watch-trigger,
--    approval-video-preview, analytics tests.
select
  'workflow_definitions'              as table_name,
  id,
  name,
  enabled,
  schedule_type                       as schedule,
  interval_minutes,
  last_run_at,
  workspace_id,
  created_at
from workflow_definitions
where
  id in (
    'wf-full-test',           -- workflow-engine.test.js
    'wf-loop-list',           -- workflow-engine-phase2.test.js
    'wf-count',               -- workflow-engine-phase2.test.js
    'wf-safety',              -- workflow-engine-phase2.test.js
    'wf-parallel',            -- workflow-engine-phase2.test.js
    'wf-inner',               -- workflow-engine-phase2.test.js
    'wf-outer',               -- workflow-engine-phase2.test.js
    'wf-decide-1',            -- self-prompting.test.js
    'wf-decide-safety',       -- self-prompting.test.js
    'wf-decide-full',         -- self-prompting.test.js
    'wf-decide-context',      -- self-prompting.test.js
    'wf-video-preview-test',  -- approval-video-preview.test.js
    'wf-text-preview-test',   -- approval-video-preview.test.js
    'analytics-wf1'           -- analytics.test.js
  )
  or name in (
    'Full test', 'Loop list', 'Count', 'Safety', 'Parallel',
    'Inner', 'Outer', 'Full self-prompt test', 'Self-prompt test 1',
    'Safety test', 'Context test', 'Video preview test', 'Text preview test',
    'Folder watch test', 'Daily Digest'
  )
order by created_at desc;


-- 3. workflow_runs ----------------------------------------------------
--    From analytics.test.js (ids r1/r2) and any run whose workflow_id
--    matches a test workflow id above.
select
  'workflow_runs'                     as table_name,
  id,
  workflow_id,
  status,
  current_node_id,
  workspace_id,
  started_at,
  completed_at
from workflow_runs
where
  id in ('analytics-r1', 'analytics-r2')
  or workflow_id in (
    'wf-full-test','wf-loop-list','wf-count','wf-safety','wf-parallel',
    'wf-inner','wf-outer','wf-decide-1','wf-decide-safety','wf-decide-full',
    'wf-decide-context','wf-video-preview-test','wf-text-preview-test',
    'analytics-wf1'
  )
order by started_at desc;


-- 4. tasks ------------------------------------------------------------
--    Hard-coded test IDs plus tasks whose instruction matches test fixtures.
--    Many tests use agent='research' with a trivial instruction - the ones
--    here are the known-fixture instructions, not any valid research task.
select
  'tasks'                              as table_name,
  id,
  agent,
  instruction,
  status,
  irreversible,
  workspace_id,
  created_at
from tasks
where
  id in (
    'analytics-t1', 'analytics-t2', 'analytics-t3', 'analytics-old'
  )
  or instruction in (
    'x', 'y', 'z', 'old',
    'Research competitor pricing'
  )
order by created_at desc;


-- 5. skills -----------------------------------------------------------
--    Fixture skill ids used by workspace-tables-phase2c.test.js (should
--    never be in a real DB because that test runs with in-memory store,
--    but the query is here as a safety net).
select
  'skills'                             as table_name,
  id,
  name,
  version,
  status,
  source_type,
  workspace_id,
  installed_at
from skills
where id in ('skill-a', 'skill-b', 'skill-legacy')
order by installed_at desc;


-- 6. long_term_memory -------------------------------------------------
--    Facts from business-profile-chat.test.js and workspace-tables-phase2c.
--    The ones from the Phase 2.3c test only ever hit the in-memory store,
--    but a leak would show up as prefixes "remember A fact" etc.
select
  'long_term_memory'                   as table_name,
  id,
  fact,
  workspace_id,
  created_at
from long_term_memory
where
  fact in (
    'remember A fact',
    'remember B fact',
    'remember legacy fact'
  )
  or fact ilike 'sanity-test %'
  or fact ilike 'test fact %'
order by created_at desc;


-- 7. outreach_threads -------------------------------------------------
--    Not stamped with fixture ids today, but test rows typically use
--    whatsapp:+1-555-0100 or example.com recipient addresses.
select
  'outreach_threads'                   as table_name,
  id,
  recipient_email,
  company_name,
  campaign,
  outreach_status,
  workspace_id,
  created_at
from outreach_threads
where
  recipient_email ilike '%@example.com'
  or recipient_email like 'whatsapp:+1-555-%'
  or recipient_email ilike 'test-%'
order by created_at desc;


-- 8. briefing_runs ----------------------------------------------------
--    Test goals used across briefing-report.test.js and
--    briefing-dashboard-articles.test.js.
select
  'briefing_runs'                      as table_name,
  id,
  goal,
  workspace_id,
  created_at
from briefing_runs
where goal in (
  'Integration test brief goal',
  'Integration test dashboard goal',
  'daily brief',
  'coverage test'
)
order by created_at desc;


-- 9. briefing_articles ------------------------------------------------
select
  'briefing_articles'                  as table_name,
  id,
  workflow_goal,
  title,
  url,
  workspace_id,
  collected_at
from briefing_articles
where
  workflow_goal in (
    'Integration test brief goal',
    'Integration test dashboard goal',
    'coverage test'
  )
  or url ilike 'https://%.example'
order by collected_at desc;


-- =====================================================================
-- SAFE DISABLE query - review the SELECT above first, then (after you've
-- confirmed each row is really a test fixture) uncomment and run this to
-- disable (NOT delete) every still-enabled test workflow so none of them
-- fire on the next scheduler tick. Deletes are intentionally not here;
-- the user audits the SELECT and chooses what to permanently remove.
-- =====================================================================
--
-- update scheduled_workflows
--    set enabled = false,
--        updated_at = now()
-- where enabled = true
--   and (
--     id in ('test-wf-crud', 'test-wf-manual')
--     or name in ('Test', 'Manual test', 'Gmail auto-triage (migrated)')
--     or goal = 'Research something'
--   )
-- returning id, name, goal, enabled;
--
-- update workflow_definitions
--    set enabled = false,
--        updated_at = now()
-- where enabled = true
--   and (
--     id in (
--       'wf-full-test','wf-loop-list','wf-count','wf-safety','wf-parallel',
--       'wf-inner','wf-outer','wf-decide-1','wf-decide-safety','wf-decide-full',
--       'wf-decide-context','wf-video-preview-test','wf-text-preview-test',
--       'analytics-wf1'
--     )
--     or name in (
--       'Full test', 'Loop list', 'Count', 'Safety', 'Parallel',
--       'Inner', 'Outer', 'Full self-prompt test', 'Self-prompt test 1',
--       'Safety test', 'Context test', 'Video preview test', 'Text preview test',
--       'Folder watch test', 'Daily Digest'
--     )
--   )
-- returning id, name, schedule_type, enabled;
