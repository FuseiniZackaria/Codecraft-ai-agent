# Testing

CodeCraft has two test modes. Neither one can touch your real database or
send real messages by default.

---

## 1. `npm test` — safe mode (default)

Run from `backend/`:

```bash
cd backend
npm test
```

What the runner (`backend/scripts/run-tests.js`) does before loading any test:

- Blanks every external credential: `SUPABASE_*`, `OPENAI_*`, `ANTHROPIC_*`,
  `AI_API_KEY`, `TAVILY_*`, `YOUTUBE_*`, `COMPOSIO_*`, `WHATSAPP_*`, `TWILIO_*`,
  `TELEGRAM_*`, `BROWSER_EXTENSION_TOKEN`, `OUTREACH_*`, `AUTO_REPLY_*`.
- Sets `CC_TESTING=1`, `CC_FORCE_MEMORY_STORE=1`, `CC_FORCE_MOCK_PROVIDER=1`,
  `ALLOW_REAL_SENDS=0`.
- Spawns `node --test` on every file in `backend/scripts/_test-list.js` via
  `spawnSync`, one at a time.

Result: tests use the in-memory `MemoryStore`, the mock LLM provider, and
`sendGuard` throws on any real send attempt.

### Current baseline (2026-10-12)

```
58/63 passed
```

### Known failing tests (pre-existing — not blocking)

| Test | Why it fails |
|---|---|
| `tests/youtube-upload.test.js` | Windows path handling for `/tmp`; test expects a Unix-only path |
| `tests/job-verification.test.js` | A fixture expected `contactStatus=UNKNOWN` but the agent now returns `APPLICATION_URL` for job-board listings — the agent behaviour is correct; the test needs updating |
| `tests/outreach-pipeline.test.js` | Pipeline now does an auto-apply pass in manual mode when `applicationUrl` is present; the test expects `verified`, gets `application_skipped` — test needs updating |
| `tests/job-lead-gen-integration.test.js` | Downstream of the two above |
| `tests/business-profile-chat.test.js` | Business profile integration — the agent flow has moved on from what the test asserts |

`tests/workflow-engine-phase2.test.js` has a timing-sensitive assertion that
can intermittently flake under load (the parallel-branches sub-test). Not
counted in the pass rate; passes most runs.

---

## 2. `npm run test:integration` — opt-in integration mode

Run from `backend/`:

```bash
cd backend
npm run test:integration
```

What `backend/scripts/run-integration-tests.js` does differently:

- **Keeps** every external API key loaded from `.env`.
- Still forces `SUPABASE_URL=''` and `CC_FORCE_MEMORY_STORE=1` — the real DB
  is never touched.
- Still sets `CC_TESTING=1`.
- Still blocks real sends unless `ALLOW_REAL_SENDS=1` is set explicitly.

Prints a bold warning about the fact that LLM calls and other API calls will
cost real money.

### Making real sends

**Only when you specifically want to.** Set the flag just for that command:

```bash
# bash
ALLOW_REAL_SENDS=1 npm run test:integration
# PowerShell
$env:ALLOW_REAL_SENDS = '1'; npm run test:integration
```

Even then, `sendGuard` only unblocks the Composio action slugs it knows about;
anything the slug matcher recognises as a write (`_SEND`, `_POST`, `_UPLOAD`,
`_SUBMIT`, `_CREATE`, `_DELETE`, `_UPDATE`, `_REMOVE`, `_REPLY`) still goes
through its own tool's approval gate. There is no "disable all safety" flag.

---

## 3. Adding a new test

1. Create `backend/tests/<topic>.test.js`.
2. Add the file path to the array in `backend/scripts/_test-list.js`.
3. Run `npm test` and watch for your test in the output.

Both runners read `_test-list.js`, so this is the one place to register tests.

---

## 4. Which flag means what

| Flag | Default (prod) | `npm test` | `npm run test:integration` |
|---|---|---|---|
| `CC_TESTING` | unset | `1` | `1` |
| `CC_FORCE_MEMORY_STORE` | unset | `1` | `1` |
| `CC_FORCE_MOCK_PROVIDER` | unset | `1` | unset |
| `ALLOW_REAL_SENDS` | unset | `0` | unset (set to `1` to allow) |
| `SUPABASE_URL` | real | blanked | blanked |
| Every external API key | real | blanked | **real** |
