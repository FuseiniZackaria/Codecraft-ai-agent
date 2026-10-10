#!/usr/bin/env node
/**
 * Default test runner - SAFE MODE.
 *
 * - Zeroes every secret-bearing env var before any Node process starts.
 * - Forces in-memory store (CC_FORCE_MEMORY_STORE=1) so tests can't touch
 *   the real Supabase project even if dotenv somehow restored a URL.
 * - Forces mockProvider (CC_FORCE_MOCK_PROVIDER=1) so router.selectProvider
 *   returns mock no matter what; aiProvider / openaiProvider are never hit.
 * - Marks CC_TESTING=1 so sendGuard refuses any accidental real send
 *   (WhatsApp, Telegram, Gmail, YouTube, Reddit, GitHub) with a loud
 *   error - safety net on top of the primary mock stubs that each test
 *   already installs.
 *
 * This runner MUST never make real external calls. If you want real
 * calls (to verify an integration still works), use the opt-in
 * `npm run test:integration` runner.
 */

// Secrets zeroed BEFORE any require(), so when config/index.js runs
// dotenv.config() these keys already exist in process.env (with empty
// string value) and dotenv's default no-override behavior leaves them
// as "". Any guard that checks `if (process.env.FOO)` sees falsy.
const SECRETS_TO_BLANK = [
  // Database
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_ANON_KEY',
  // LLM / AI
  'OPENAI_API_KEY',
  'AI_API_KEY',
  'ANTHROPIC_API_KEY',
  // Search / web
  'TAVILY_API_KEY',
  'YOUTUBE_API_KEY',
  // Composio (and the pinned connected-account ids)
  'COMPOSIO_API_KEY',
  'COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID',
  'COMPOSIO_REDDIT_CONNECTED_ACCOUNT_ID',
  'COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID',
  // WhatsApp (Meta direct)
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  // WhatsApp (Twilio Sandbox)
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_FROM',
  // Telegram
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  // Browser extension pairing token
  'BROWSER_EXTENSION_TOKEN',
  // Owner-notification destinations (so a test can't text or email the user)
  'OWNER_TELEGRAM_CHAT_ID',
  'OWNER_WHATSAPP_NUMBER',
];
for (const key of SECRETS_TO_BLANK) process.env[key] = '';

// Also force the "automatic" automation switches OFF for tests. These are
// not secrets but misconfigured as "true" they could, in principle, let a
// scheduler tick during a test queue a real send that then gets blocked
// by the guard but still spams the shadow log.
process.env.OUTREACH_MODE = 'manual';
process.env.OUTREACH_AUTOMATIC_ENABLED = 'false';
process.env.TELEGRAM_AUTO_REPLY_ENABLED = 'false';
process.env.WHATSAPP_AUTO_REPLY_ENABLED = 'false';
process.env.GMAIL_TRIAGE_INTERVAL_MINUTES = '0';
process.env.OUTREACH_RESPONSE_CHECK_INTERVAL_MINUTES = '0';
process.env.OUTREACH_FOLLOWUP_CHECK_INTERVAL_MINUTES = '0';

// Mark the run as a test so sendGuard can refuse any real send attempt.
process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';

// ALLOW_REAL_SENDS must NEVER be inherited into the default suite. If an
// invoker had it set in their shell, clear it here - safe mode means safe
// mode. (Integration runner has its own, deliberate handling.)
delete process.env.ALLOW_REAL_SENDS;

// Last-line sanity check. If any secret is still populated after the
// override above (e.g. because someone wires a new one and forgets to
// add it to SECRETS_TO_BLANK), fail loud.
const stillLive = SECRETS_TO_BLANK.filter((k) => process.env[k]);
if (stillLive.length) {
  console.error(`[test-runner] REFUSING to start: these secrets are still set after override: ${stillLive.join(', ')}`);
  process.exit(2);
}

const { spawnSync } = require('child_process');
const path = require('path');

const TESTS = require('./_test-list');
const BACKEND_DIR = path.resolve(__dirname, '..');

const envForChild = { ...process.env };

console.log('[test-runner] SAFE MODE: every test runs with no real credentials.');
console.log('[test-runner]   - DB forced in-memory (CC_FORCE_MEMORY_STORE=1)');
console.log('[test-runner]   - LLM forced to mockProvider (CC_FORCE_MOCK_PROVIDER=1)');
console.log(`[test-runner]   - ${SECRETS_TO_BLANK.length} secret env vars blanked`);
console.log('[test-runner]   - CC_TESTING=1 (sendGuard refuses real sends if reached)');
console.log(`[test-runner] Running ${TESTS.length} tests in fresh child processes\n`);

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
