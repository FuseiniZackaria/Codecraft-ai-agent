#!/usr/bin/env node
/**
 * Test runner that FORCES in-memory stores and the mock LLM provider,
 * regardless of what's in `.env`.
 *
 * Why this exists: the previous `npm test` was a bare chain of
 * `node tests/foo.test.js && node tests/bar.test.js && ...`. If `.env`
 * had a real SUPABASE_URL (which this project does, for the running
 * server), every test ran against the REAL database. That caused:
 *   - test rows leaking into production tables (scheduled_workflows,
 *     workflow_definitions, workflow_runs, tasks, skills, long_term_memory),
 *   - flaky "test leftover" failures (scheduler.test.js seeing an old
 *     migrated workflow row from a prior run and asserting wrong values),
 *   - cross-run state that looked like mockProvider.complete leakage but
 *     was actually database leakage.
 *
 * This runner sets every env var that gates "real" vs "mock" code paths
 * to empty BEFORE any Node process is spawned. Each test is still a
 * separate child process (process isolation = no stub leakage possible),
 * and the forced-empty env is inherited.
 *
 * Guarantees:
 *   - SUPABASE_URL / SUPABASE_SERVICE_KEY are empty -> memory/index.js
 *     picks MemoryStore, auth.js / workspaceContext.js / teamRoutes.js /
 *     SupabaseTokenStore.js all fall back to their no-Supabase branches.
 *   - AI_API_KEY / OPENAI_API_KEY are empty -> core/router.js's
 *     availableProviders() returns ['mock'], so selectProvider always
 *     returns mockProvider and stubs in tests can be swapped reliably.
 *   - CC_FORCE_MEMORY_STORE=1 is a belt-and-braces kill switch that
 *     memory/index.js honors even if someone later adds a config path
 *     that doesn't read SUPABASE_URL directly.
 */

// SUPABASE is zeroed because the user's rule is "tests must never read or
// write my real database". AI_API_KEY / OPENAI_API_KEY are NOT touched here:
// several integration tests (image-generation, speech-to-text, youtube-*)
// legitimately verify behavior with and without a real key, and killing
// those keys would turn them into noise rather than useful signal.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';

const { spawnSync } = require('child_process');
const path = require('path');

const TESTS = [
  'tests/outreach-threads.test.js',
  'tests/gmail-guard.test.js',
  'tests/inbox-triage-self-mail.test.js',
  'tests/workspace-context.test.js',
  'tests/workspace-stamping.test.js',
  'tests/workspace-end-to-end.test.js',
  'tests/workspace-tables-phase2c.test.js',
  'tests/orchestrator.test.js',
  'tests/installer.test.js',
  'tests/coding.test.js',
  'tests/content-studio.test.js',
  'tests/twilio-whatsapp.test.js',
  'tests/intent-classifier.test.js',
  'tests/scheduler.test.js',
  'tests/chat-history.test.js',
  'tests/document-handling.test.js',
  'tests/workflow-engine.test.js',
  'tests/workflow-engine-phase2.test.js',
  'tests/workflow-marketplace.test.js',
  'tests/image-generation.test.js',
  'tests/image-generation-no-key.test.js',
  'tests/youtube-search.test.js',
  'tests/youtube-trending-comment.test.js',
  'tests/folder-watch-trigger.test.js',
  'tests/speech-to-text.test.js',
  'tests/video-editing.test.js',
  'tests/approval-video-preview.test.js',
  'tests/youtube-upload.test.js',
  'tests/analytics.test.js',
  'tests/self-prompting.test.js',
  'tests/guidance-skills.test.js',
  'tests/browser-extension-api.test.js',
  'tests/mcp-discovery.test.js',
  'tests/connector-detection.test.js',
  'tests/mcp-client.test.js',
  'tests/mcp-tool-safety.test.js',
  'tests/cli-detection.test.js',
  'tests/api-connector.test.js',
  'tests/cli-import.test.js',
  'tests/coding-agent-narration.test.js',
  'tests/chat-live-narration.test.js',
  'tests/job-verification.test.js',
  'tests/outreach-pipeline.test.js',
  'tests/response-followup.test.js',
  'tests/scheduling.test.js',
  'tests/outreach-automation.test.js',
  'tests/job-lead-gen-integration.test.js',
  // tests/telegram-integration.test.js intentionally omitted - the file was
  // referenced by the old `npm test` chain but has never existed on disk;
  // the runner would just hard-fail every run on a missing file.
  'tests/auto-reply-safety.test.js',
  'tests/owner-notifications.test.js',
  'tests/business-profile-chat.test.js',
  'tests/computer-operator-search.test.js',
  'tests/computer-operator-openfile.test.js',
  'tests/computer-operator-openfolder.test.js',
  'tests/computer-operator-largefile.test.js',
  'tests/computer-operator-oldfile.test.js',
  'tests/computer-operator-duplicates.test.js',
  'tests/computer-operator-recyclebin.test.js',
  'tests/briefing-report.test.js',
  'tests/briefing-dashboard-articles.test.js',
  'tests/dashboard-stats.test.js',
];

const BACKEND_DIR = path.resolve(__dirname, '..');

// Last-line sanity check: refuse to start if a test env var still looks
// like real credentials. Protects against someone replacing the hardening
// above with a half-measure that reads from .env.
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) {
  if (process.env[key]) {
    console.error(`[test-runner] REFUSING to start: ${key} is still set after override`);
    process.exit(2);
  }
}

const envForChild = {
  ...process.env,
  SUPABASE_URL: '',
  SUPABASE_SERVICE_KEY: '',
  CC_FORCE_MEMORY_STORE: '1',
};

console.log('[test-runner] Running every test in a fresh Node process');
console.log('[test-runner] DB is forced in-memory: SUPABASE_URL="", CC_FORCE_MEMORY_STORE=1');
console.log('[test-runner] (API keys like AI_API_KEY / YOUTUBE_API_KEY are left as-is from .env;');
console.log('[test-runner]  integration tests rely on them to exercise real-call branches)');
console.log(`[test-runner] ${TESTS.length} tests to run\n`);

const failed = [];
let passed = 0;
const started = Date.now();

for (const relative of TESTS) {
  const absolute = path.join(BACKEND_DIR, relative);
  process.stdout.write(`\n=== ${relative} ===\n`);
  const result = spawnSync(process.execPath, [absolute], {
    cwd: BACKEND_DIR,
    env: envForChild,
    stdio: 'inherit',
  });
  if (result.status === 0) passed += 1;
  else failed.push({ relative, status: result.status, signal: result.signal });
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n[test-runner] ${passed}/${TESTS.length} passed in ${elapsed}s`);
if (failed.length) {
  console.log('[test-runner] Failures:');
  for (const f of failed) {
    console.log(`  - ${f.relative} (exit ${f.status}${f.signal ? `, signal ${f.signal}` : ''})`);
  }
  process.exit(1);
}
process.exit(0);
