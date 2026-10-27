# CodeCraft AI — Progress

## Fix: invited workspaces didn't see their own tasks

- `SupabaseStore.saveTask` and `addChatMessage` never wrote `workspace_id`, so every task and chat row was saved with no workspace. Since the isolation fix, no-workspace rows show only to the app owner, so an invited workspace's tasks appeared on the owner's Tasks page instead of theirs. Both now store the workspace.
- **Run `backend/database/migrations/0004_restamp_task_workspace.sql` in Supabase** to move existing tasks (and their linked chat replies) back to the workspace that created them, using the audit log.
- Test: `supabase-store-workspace-stamp`.

## Google Sheets lead storage

- New `sheets` plugin (`sheets.saveLead`, no approval gate) backed by `core/googleSheets.js` (`googleapis`, Google service account from `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_FILE`). Appends `timestamp (UTC ISO), name, email, phone, source, notes` to the first worksheet, writes the header row if missing, skips a lead whose email is already there (case-insensitive), only `name` required, clear errors for missing config or a sheet not shared with the service account.
- **Sales Manager** lead-gen saves every lead it keeps (after the no-source filter) when the workspace has a sheet; a sheet error is a warning in the run, never a failure. The run summary says how many were saved.
- **Per workspace:** Connections → **Google Sheets** (paste the sheet link; the server verifies access). `LEADS_SHEET_ID` is a fallback for the owner workspace only.
- Setup steps: `docs/connecting-accounts.md`. Live check: `npm run check:sheets`. Test: `sheets-save-lead` (mocked).

## Security fix: invited workspaces saw the owner's tasks and activity

- **Live activity stream** (`/api/events/stream`) broadcast every workspace's events to every open page. It now sends only the caller's workspace events.
- **Unstamped rows** (`workspace_id = null`: pre-workspace history and background jobs such as webhooks, which can't resolve a workspace once there are two) were returned to every workspace by every list. They now belong to the app owner's workspace only (`canSeeLegacy`), in both stores and in the route filters. If the owner workspace can't be resolved, nobody sees them.
- **By-id routes** let any admin read, approve, reject, edit or delete another workspace's task (and edit/delete workflows, manage skills) by id. They now return 404 for anything outside the caller's workspace. `mark-all-read` only touches the caller's own tasks.
- Coding agent plan narration is now stamped with the workspace.
- Test: `workspace-legacy-visibility` (lists, by-id actions, mark-all-read, live stream).
- Note: inviting someone as **"Team member of my workspace"** shares your workspace on purpose — use **"New business (own workspace)"** for a separate one.

## Sign in with an email code

- Sign-in page has **Sign in with an email code**: enter your email, get a one-time code by email, type it in. Uses Supabase email OTP with `shouldCreateUser: false`, so it only works for existing (invited) accounts and never creates new ones. Disabled accounts are still refused.
- **Required Supabase setting:** Authentication → Emails → **Magic Link** template must contain `{{ .Token }}` (the default template only has a link). Code length is set under Authentication → Providers → Email → Email OTP Length (6 by default).

## Fix: invited users create a password

- Invite links signed people straight into the app with no password, so after logging out they couldn't sign in. Invites (and resends) now mark the account `user_metadata.needs_password` and link to `/set-password`; while the flag is set the app only shows **Create your password**, and saving it clears the flag and opens the app.
- Add `https://<your frontend>/set-password` to **Supabase → Authentication → URL Configuration → Redirect URLs** (otherwise Supabase sends people to the Site URL; the flag still forces the form).
- People who already accepted an old invite use **Forgot password** on the sign-in page.

## Fix: Composio sign-in finishes by itself

- After the Google / GitHub sign-in, Composio now returns the browser to the app's **Connections** page (it used to go to a non-existent `/api/connections/<provider>/callback`), which completes the connection and shows "Gmail connected as …". The Connect dialog also checks every few seconds, so the original tab updates too. Only the app's own origins (`CORS_ALLOWED_ORIGINS`) are accepted as the return address.
- The Plugins page no longer sends Gmail / Calendar / GitHub to the Composio dashboard ("Manage in Composio" doesn't connect anything); it links to the Connections page.

## Fix: owner can reconnect an expired Gmail / Calendar / GitHub

- If the server's legacy (.env) account's token expires (Composio 401 "invalid or expired"), the owner clicks **Disconnect** then **Connect**: the legacy account is remembered as dismissed (never revoked, never re-attached), and the new sign-in is stored under `ws_<owner workspace>`. Previously the card re-attached the expired account on every load, so Connect never appeared.
- The legacy account is also skipped automatically when Composio reports it as not ACTIVE.

## Phase 2.7c: App-owner "Close account" + SMTP guide

- **Close account (app owner only, other workspaces):** on the Team page, "Close account" opens a dialog where you type the account's email and choose:
  - **Disable account** (default) — Supabase ban; they can't sign in (existing sessions are refused too); all data kept; **Re-enable** button undoes it. Disabled accounts show a "Disabled" badge.
  - **Delete account and workspace** — downloads a JSON backup of every workspace they own first (encrypted tokens stripped; also saved under `backend/data/backups/` on the server, which Render wipes on redeploy — keep the downloaded copy), then deletes workspace data, connections, profile, membership, roles and the auth user in foreign-key order. If the backup fails, nothing is deleted.
  - Never touches your own account or any account in your own workspace. Normal admins still get "You can't remove a workspace owner."
- **SMTP guide:** "Getting rate-limited on invites?" now has real steps (Supabase → Authentication → Emails → SMTP Settings, Gmail app password or Resend free tier, then raise the email rate limit).
- **Tests:** `team-close-account` (disable, re-enable, delete with backup, FK order, owner untouched).

## Phase 2.7b: Composio cross-workspace security fix

- **Bug:** a second workspace showed Gmail / Calendar / GitHub as "Connected" with no sign-in. The old connect route fell back to adopting the first ACTIVE account in the whole Composio project (the owner's) and saved it on that workspace; before 2.7 every action also ran as the shared `COMPOSIO_USER_ID` + `.env` pinned ids, so any workspace's Gmail/Calendar/GitHub actions ran on the owner's account.
- **Fix:** each workspace has its own Composio entity `ws_<workspace_id>`. Connect always starts a fresh OAuth flow for that entity (never adopts). A stored connection is trusted only if it belongs to that entity; otherwise the workspace is blocked with "Connect Gmail first". `.env` ids are used only by the owner's workspace (its existing connection is mapped to it, no reconnect needed) and by background jobs with no workspace.
- **Cards** show the connected account's email / username. **Disconnect** removes only that workspace's row and revokes only an account under its own entity — never the owner's.
- **Cleanup:** stale rows are removed automatically the next time the Connections page loads (database only — nothing is revoked at Composio). `COMPOSIO_PER_WORKSPACE` flag removed.
- **Tests:** `composio-per-workspace`, `composio-connection-routes` (B must go through OAuth, never sees A's connection, `.env` ids never used for user workspaces).

## Phase 2.7: Per-workspace Composio connections

- **Own account per workspace:** `core/composio.js` resolves the Composio user and connected account from the calling workspace's `workspace_connections` row. A workspace with no connection gets a clear "not connected" error — it never falls back to the owner's `.env` account. YouTube / Reddit (single server account) are owner-only.
- **Connect flow:** uses `connectedAccounts.link()` under the workspace id as the Composio user (the old REST initiate endpoint is retired for managed OAuth). `/check` only accepts accounts owned by that user; a guessed or foreign connection id is rejected.
- **Owner workspace unchanged:** it keeps using the server's legacy account (adopted on connect) and system callers with no workspace behave as before.
- **Shadow-log leaks closed:** assistant (Ian) department tasks now carry the workspace. A path audit also fixed writes that enforce mode would have refused: pausing a workflow run for approval, enabling/disabling a skill, the legacy Gmail-triage migration (now a named system call), and the Coding agent's audit events.
- **Per-workspace Ian usage & cap:** `assistant_usage_daily` is now one row per (day, workspace). **Run `backend/database/migrations/0003_assistant_usage_per_workspace.sql` in Supabase BEFORE deploying** — until then usage isn't persisted (it keeps counting in memory; nothing else breaks).
- **Cross-workspace access closed:** "Run now", workflow-definition run/resume/cancel, and Ian's `check_task_result` report another workspace's row as not found.
- **Tests:** new `assistant-workspace-scope` (Ian task + usage stamped, enforce mode), `composio-per-workspace`, `composio-connection-routes`; six stale/flaky tests repaired.

## Phase 2.6b: Team invite fixes & app-owner controls

- **Email typo detection:** Common domain misspellings (gmail.co, gmial.com, outlok.com, etc.) trigger a "Did you mean...?" prompt before sending, both client-side and server-side.
- **Confirmation dialog:** Every invite now requires an explicit confirmation step before the email is sent.
- **Pending invites:** Admins who haven't signed in yet show an "Invite pending" badge with Resend and Cancel buttons. Cancel deletes the auth user and their empty workspace (respects ON DELETE RESTRICT ordering).
- **App-owner super-admin:** The app owner (APP_OWNER_EMAIL or APPLICANT_EMAIL) can see all admins across all workspaces, remove members from any workspace with typed-confirmation safety, and cancel pending invites.
- **Rate-limit handling:** Supabase email rate-limit errors return a friendly "Too many invites right now. Try again in an hour." message. An expandable SMTP setup guide is shown on the Team page.
- **listTasks guard fix:** Routes now return empty results when workspaceId is null instead of calling the workspace guard with an unscoped query — eliminates the `list_without_workspace` shadow-log noise.
- **Composio lockdown:** Gmail, Google Calendar, and GitHub (Composio) connect/status/check blocked for non-owner workspaces. (Per-workspace entity ids landed in Phase 2.7.)

## Phase 2.6: Team invites & workspace isolation

- **Two invite modes:** "New business (own workspace)" creates an empty workspace; "Team member of my workspace" shares the caller's workspace.
- **Email invites:** New admins receive an email with a link to set their own password. No password is ever shown, typed, or sent by the inviting admin.
- **Ownership controls:** Only the workspace owner can add or remove members. Members cannot modify team membership. Nobody can add themselves to another workspace.
- **Onboarding:** New-workspace admins see a step-by-step banner on the Dashboard: (1) Set up business profile, (2) Connect an account, (3) Send a test message.
- **Isolation enforced:** A new-workspace admin sees zero data from any other workspace — tasks, chat, connections, business profile are all scoped. A team member sees only their shared workspace.

## Phase 2.5: Per-workspace connections

- **Connections page:** Cards for Gmail, Google Calendar, GitHub, Telegram, WhatsApp with Connect / Test / Disconnect.
- **Telegram wizard:** BotFather flow — paste token, auto-verify with `getMe`, auto-register webhook.
- **WhatsApp:** Two options — Meta Cloud API (Phone Number ID + Access Token + App Secret) or Twilio (Account SID + Auth Token + number).
- **Gmail / Calendar / GitHub:** Composio hosted connect — opens sign-in window, stores connection ID.
- **Credential security:** AES-256-GCM encryption for bot tokens and API keys. Never returned in API responses or logged.
- **Webhook routing:** Random UUID tokens in webhook URLs route incoming messages to the owning workspace. Legacy routes preserved for backward compatibility.

## Phase 2.4: Per-workspace business profile

- Settings page drives agent prompts (outreach tone, email signature, offers).
- `business_profile` table scoped to workspace.

## Phase 2.3d: Workspace guard enforce mode

- `WORKSPACE_GUARD_MODE=enforce` live on Render.
- Null-workspace backfill for legacy rows.
- Two-account isolation test.

## Phase 2.3: Workspace stamping & guard

- Every store write carries `workspace_id`.
- Shadow-log catches unscoped calls.
- System-scope callers allowlisted.

## Phase 2.1: Workspace schema

- `workspaces`, `workspace_members`, `workspace_connections`, `business_profile` tables.
- `workspace_id` column added to all admin-owned tables.
- RLS on new tables; shadow-mode logging on existing tables.
- Single-workspace backfill for existing data.
