# CodeCraft AI — Progress

## Phase 2.6b: Team invite fixes & app-owner controls (current)

- **Email typo detection:** Common domain misspellings (gmail.co, gmial.com, outlok.com, etc.) trigger a "Did you mean...?" prompt before sending, both client-side and server-side.
- **Confirmation dialog:** Every invite now requires an explicit confirmation step before the email is sent.
- **Pending invites:** Admins who haven't signed in yet show an "Invite pending" badge with Resend and Cancel buttons. Cancel deletes the auth user and their empty workspace (respects ON DELETE RESTRICT ordering).
- **App-owner super-admin:** The app owner (APP_OWNER_EMAIL or APPLICANT_EMAIL) can see all admins across all workspaces, remove members from any workspace with typed-confirmation safety, and cancel pending invites.
- **Rate-limit handling:** Supabase email rate-limit errors return a friendly "Too many invites right now. Try again in an hour." message. An expandable SMTP setup guide is shown on the Team page.
- **listTasks guard fix:** Routes now return empty results when workspaceId is null instead of calling the workspace guard with an unscoped query — eliminates the `list_without_workspace` shadow-log noise.
- **Composio lockdown:** Gmail, Google Calendar, and GitHub (Composio) connect/status/check blocked for non-owner workspaces. TODO: per-workspace Composio entity ids (security fix pending).

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
