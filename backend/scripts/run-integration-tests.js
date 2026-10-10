#!/usr/bin/env node
/**
 * Opt-in INTEGRATION TEST runner.
 *
 * Unlike scripts/run-tests.js (safe default), this runner leaves your
 * real API keys from .env ALONE so tests can verify integrations with
 * real external services. Supabase is STILL forced to in-memory - the
 * database rule is not negotiable - but LLM providers, Composio,
 * YouTube, Tavily, etc. keep their real credentials.
 *
 * Even in this mode, outbound SENDS (WhatsApp, Telegram, Gmail,
 * YouTube upload, Reddit post, GitHub write) are refused by
 * core/sendGuard.js unless you additionally pass ALLOW_REAL_SENDS=1 -
 * see the banner it prints below. The two switches are deliberately
 * separate: a user can opt into "real integrations, no real sends"
 * (e.g. verify a YouTube search still parses correctly) without ever
 * posting a comment or messaging someone.
 *
 * Pass test paths to run just those; omit to run the whole list.
 *   node scripts/run-integration-tests.js tests/youtube-search.test.js
 *   npm run test:integration -- tests/outreach-pipeline.test.js
 *   ALLOW_REAL_SENDS=1 npm run test:integration -- tests/twilio-whatsapp.test.js
 */

// Database stays in-memory even in integration mode. The rule is DB only.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';

// Mark the run so sendGuard activates. If ALLOW_REAL_SENDS=1 is set
// (either in the shell or inline before the npm command), it stays set
// and the guard lets sends through; otherwise the guard throws on any
// outbound send attempt and the test fails loud rather than quietly
// messaging someone.
process.env.CC_TESTING = '1';

const allowReal = process.env.ALLOW_REAL_SENDS === '1';

// Big visible banner so the user never confuses this with safe mode.
console.log('');
console.log('==========================================================');
console.log(' INTEGRATION TEST MODE - real API keys are IN SCOPE');
console.log('==========================================================');
console.log(' * Supabase is still forced in-memory (no DB writes).');
console.log(' * LLM / Composio / Twilio / Telegram / YouTube / Tavily');
console.log('   keys from .env ARE loaded. Running tests may:');
console.log('     - make PAID API calls (Anthropic, OpenAI, Tavily, ...)');
console.log('     - read your real Gmail inbox');
console.log('     - execute real search queries you can see billed');
console.log('');
if (allowReal) {
  console.log(' !! ALLOW_REAL_SENDS=1 is SET - WhatsApp / Telegram / Gmail /');
  console.log(' !! YouTube upload / Reddit / GitHub writes CAN FIRE. Make');
  console.log(' !! sure every test you run here has its own stub, or you');
  console.log(' !! will actually post / message / upload to a real recipient.');
} else {
  console.log(' * ALLOW_REAL_SENDS is NOT set - outbound SENDS are blocked by');
  console.log('   core/sendGuard.js and will throw with a clear "refused"');
  console.log('   error if any test reaches a real send function.');
  console.log('   To opt in deliberately: ALLOW_REAL_SENDS=1 npm run test:integration');
}
console.log('==========================================================');
console.log('');

const { spawnSync } = require('child_process');
const path = require('path');
const defaultList = require('./_test-list');

const argv = process.argv.slice(2);
// Everything that looks like a test path - supports both forward and
// backslashes so Windows users can paste either shape.
const requested = argv.filter((a) => /\.test\.js$/i.test(a)).map((p) => p.replace(/\\/g, '/'));
const TESTS = requested.length ? requested : defaultList;

const BACKEND_DIR = path.resolve(__dirname, '..');
const envForChild = { ...process.env };

console.log(`[integration-runner] Running ${TESTS.length} test file(s) in fresh child processes`);
console.log(`[integration-runner] ALLOW_REAL_SENDS = ${allowReal ? '1 (real sends ALLOWED)' : 'unset (sends BLOCKED)'}\n`);

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
console.log(`\n[integration-runner] ${passed}/${TESTS.length} passed in ${elapsed}s`);
if (failed.length) {
  console.log('[integration-runner] Failures:');
  for (const f of failed) {
    console.log(`  - ${f.relative} (exit ${f.status}${f.signal ? `, signal ${f.signal}` : ''})`);
  }
  process.exit(1);
}
process.exit(0);
