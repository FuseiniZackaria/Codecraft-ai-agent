# API reference

Every backend route, grouped by mount point. "Auth" column:

- **open** — no authentication required.
- **token** — expects `X-CodeCraft-Token: <BROWSER_EXTENSION_TOKEN>`.
- **requireAuth** — expects Supabase JWT.
- **admin** — `requireAuth` + user has the `admin` role.

---

## `/webhooks/*` — open (webhookLimiter)

| Method | Path | Purpose |
|---|---|---|
| GET | `/webhooks/whatsapp` | Meta Cloud API webhook verification handshake |
| POST | `/webhooks/whatsapp` | Inbound Meta WhatsApp message |
| POST | `/webhooks/whatsapp/twilio` | Inbound Twilio Sandbox / Twilio Business WhatsApp |
| POST | `/webhooks/telegram` | Inbound Telegram message |

---

## Top-level (open or minimally gated)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | open | Liveness check — returns 200 |
| GET | `/api/public-config` | open | `{ assistantName, assistantNameVariations }` so the frontend knows what to call Ian |

---

## `/api/me` and `/api/workspace/me`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/me` | requireAuth | `{ id, email, role, dashboardGoal, workspaceId, workspaceName, workspaceRole }` |
| GET | `/api/workspace/me` | requireAuth | `{ workspaceId, workspaceName, role }` — a lighter version used by the Workspace selector |
| GET | `/api/workspace/shadow-log` | admin | Last 200 entries from the shadow log (JSON array) |
| POST | `/api/workspace/shadow-log/clear` | admin | Unlinks `backend/data/workspace_shadow.log` |

---

## `/api/*` — admin (routes.js, generalApiLimiter)

### Composio status

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/composio/gmail/status` | `{ connected, connectedAccountId? }` |
| GET | `/api/composio/reddit/status` | same |
| GET | `/api/composio/github/status` | same |
| GET | `/api/composio/googlecalendar/status` | same |
| GET | `/api/composio/whatsapp/status` | same |
| GET | `/api/composio/telegram/status` | same |

### Chat with Ian

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat` | `{ message, history? }` → `{ reply, actionable, task?, remembered? }` |
| POST | `/api/chat/stream` | SSE variant that streams the reply |
| GET | `/api/chat/history` | Last `limit` chat messages (default 50) |
| GET | `/api/assistant/usage` | Daily LLM spend for the current workspace (used to show the daily-cap bar) |

### Orchestrator (direct)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/orchestrator/goal` | `{ goal, payload?, overrideProvider?, category?, departmentKey?, agentKey? }` → the task(s) created (rate-limited by `goalSubmissionLimiter`) |

### Tasks

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tasks/:id` | One task by id |
| GET | `/api/tasks` | All tasks in the current workspace |
| DELETE | `/api/tasks/:id` | Permanently delete |
| POST | `/api/tasks/bulk-delete` | `{ ids: [...] }` → `{ deleted, failed, errors }` |
| POST | `/api/tasks/mark-all-read` | Marks every task in the workspace as read |
| PATCH | `/api/tasks/:id/payload` | Edit a pending-approval task's payload before approving |
| POST | `/api/tasks/:id/approve` | Dispatches the task through `orchestrator.approveTask` |
| POST | `/api/tasks/:id/reject` | Marks the task `rejected` |

### Agents + dashboard

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/agents` | `{ sections, agents }` — every registered agent + its department metadata |
| GET | `/api/dashboard/summary` | Counts for the home-page tiles |

---

## `/api/events` — admin

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/events/recent` | Last N audit entries (scoped to the current workspace) |
| GET | `/api/events/stream` | Server-Sent Events — new activity events pushed in real time |

---

## `/api/skills` — admin

Universal Skill Installer.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/skills/registry/search?q=…` | Search the public skill registry |
| GET | `/api/skills/registry/categories` | List registry categories |
| GET | `/api/skills/registry/:id` | Details for one registry skill |
| POST | `/api/skills/preview` | `{ source }` → manifest + required permissions |
| POST | `/api/skills/install` | `{ source, approvedPermissions }` → installed skill |
| GET | `/api/skills` | Installed skills |
| GET | `/api/skills/search?q=…` | Search installed skills |
| GET | `/api/skills/:id` | One installed skill |
| POST | `/api/skills/:id/enable` | Activate |
| POST | `/api/skills/:id/disable` | Deactivate |
| DELETE | `/api/skills/:id` | Remove |
| POST | `/api/skills/:id/reinstall` | Reinstall from source |
| POST | `/api/skills/:id/repair` | Re-verify checksum + re-activate |
| GET | `/api/skills/:id/update-check` | Is an update available |
| POST | `/api/skills/:id/update` | Apply the update |
| POST | `/api/skills/:id/backup` | Zip the installed folder |
| POST | `/api/skills/:id/restore` | Restore from a zip |

---

## `/api/workspace` — admin (coding workspace browser, **not** tenant workspace)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workspace/:projectId/files` | List files in a Coding agent project |
| GET | `/api/workspace/:projectId/file/*` | Stream a specific file |
| GET | `/api/workspace/:projectId/download` | Zip + download the whole project |

---

## `/api/workflows` — admin (simple scheduled workflows)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workflows` | All workflows in the current workspace |
| POST | `/api/workflows` | Create a workflow |
| PATCH | `/api/workflows/:id` | Edit |
| DELETE | `/api/workflows/:id` | Delete |
| POST | `/api/workflows/:id/run-now` | Fire outside the normal schedule |

---

## `/api/workflow-definitions` — admin (graph workflows)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workflow-definitions/registry/search?q=…` | Marketplace |
| GET | `/api/workflow-definitions/registry/categories` | Categories |
| GET | `/api/workflow-definitions/registry/:id` | One template |
| POST | `/api/workflow-definitions/registry/:id/install` | Install template into this workspace |
| GET | `/api/workflow-definitions` | List |
| POST | `/api/workflow-definitions` | Create |
| GET | `/api/workflow-definitions/:id` | Read |
| PATCH | `/api/workflow-definitions/:id` | Edit |
| DELETE | `/api/workflow-definitions/:id` | Delete |
| GET | `/api/workflow-definitions/:id/runs` | Run history for one definition |
| POST | `/api/workflow-definitions/:id/run` | Fire manually |
| POST | `/api/workflow-definitions/runs/:runId/resume` | Resume a paused run (after approval) |
| POST | `/api/workflow-definitions/runs/:runId/cancel` | Cancel a paused run |
| GET | `/api/workflow-definitions/runs/:runId` | One run row |

---

## `/api/analytics` — admin

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/analytics/summary` | Aggregated counts: task statuses, audit events, workflows |

---

## `/api/dashboard` — admin **or** client

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/dashboard/briefing?goal=…` | Dashboard stats for a specific recurring briefing (reads `briefing_articles`) |

---

## `/api/browser` — token (not JWT)

Used by the companion browser extension. Protected by `X-CodeCraft-Token`
header, which must equal `BROWSER_EXTENSION_TOKEN`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/browser/visit` | `{ url }` — extension signals it's on this URL |
| GET | `/api/browser/current` | What URL the extension last reported |
| GET | `/api/browser/recent` | Recent URLs the extension reported |
| GET | `/api/browser/check-mcp` | Is MCP available in this environment |
| GET | `/api/browser/check-cli` | Is `claude` CLI available |
| POST | `/api/browser/cli/import` | Import a session from the CLI |
| GET | `/api/browser/detections` | Service detections the extension noticed |
| GET | `/api/browser/prompt` | Current connector prompt (empty unless one is pending) |

---

## `/api/mcp` — admin + token

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/mcp/connect` | Open an MCP session |
| POST | `/api/mcp/call` | Call an MCP tool |
| GET | `/api/mcp/sessions` | List open sessions |

---

## `/api/team` — admin

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/team` | List admin users |
| POST | `/api/team` | **Disabled** — returns 409 until Phase 2.5 lands (per-admin connections) |
| DELETE | `/api/team/:userId` | Revoke admin role from a user (rate-limited) |

---

## `/api/auth/google/*` — admin

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/google` | Begin Google OAuth (for direct-API Google Calendar) |
| GET | `/api/auth/google/callback` | OAuth redirect handler |
| GET | `/api/auth/google/status` | Is a Google token on file |
