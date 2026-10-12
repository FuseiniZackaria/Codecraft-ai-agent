# API reference

Auth key:
`open` = no auth · `token` = `X-CodeCraft-Token` header ·
`auth` = Supabase JWT · `admin` = JWT + `admin` role.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | open | Liveness |
| GET | `/api/public-config` | open | `{ assistantName, assistantNameVariations }` |
| GET | `/webhooks/whatsapp` | open | Meta webhook verification |
| POST | `/webhooks/whatsapp` | open | Inbound Meta WhatsApp |
| POST | `/webhooks/whatsapp/twilio` | open | Inbound Twilio WhatsApp |
| POST | `/webhooks/telegram` | open | Inbound Telegram |
| GET | `/api/me` | auth | Current user + workspace fields |
| GET | `/api/workspace/me` | auth | Workspace id/name/role only |
| GET | `/api/workspace/shadow-log` | admin | Last 200 shadow-log entries |
| POST | `/api/workspace/shadow-log/clear` | admin | Wipe the shadow log |
| GET | `/api/composio/{gmail,reddit,github,googlecalendar,whatsapp,telegram}/status` | admin | Per-integration status |
| POST | `/api/chat` | admin | Send a chat message to the assistant |
| POST | `/api/chat/stream` | admin | SSE variant |
| GET | `/api/chat/history` | admin | Chat history (default last 50) |
| GET | `/api/assistant/usage` | admin | Daily chat spend |
| POST | `/api/orchestrator/goal` | admin | Submit a goal directly |
| GET | `/api/tasks/:id` | admin | One task |
| GET | `/api/tasks` | admin | All tasks in current workspace |
| DELETE | `/api/tasks/:id` | admin | Delete |
| POST | `/api/tasks/bulk-delete` | admin | `{ ids: [...] }` |
| POST | `/api/tasks/mark-all-read` | admin | Mark all read |
| PATCH | `/api/tasks/:id/payload` | admin | Edit a pending task's payload |
| POST | `/api/tasks/:id/approve` | admin | Approve → dispatch tool |
| POST | `/api/tasks/:id/reject` | admin | Reject → mark `rejected` |
| GET | `/api/agents` | admin | Registered agents + department metadata |
| GET | `/api/dashboard/summary` | admin | Home-page tile counts |
| GET | `/api/events/recent` | admin | Last N audit entries (scoped) |
| GET | `/api/events/stream` | admin | SSE live audit stream |
| GET | `/api/skills/registry/{search,categories,:id}` | admin | Public skill registry |
| POST | `/api/skills/{preview,install}` | admin | Preview / install from source |
| GET | `/api/skills` | admin | Installed skills |
| GET | `/api/skills/search` | admin | Installed-skill search |
| GET | `/api/skills/:id` | admin | One installed skill |
| POST | `/api/skills/:id/{enable,disable,reinstall,repair,backup,restore,update}` | admin | Lifecycle actions |
| DELETE | `/api/skills/:id` | admin | Remove |
| GET | `/api/skills/:id/update-check` | admin | Update available? |
| GET | `/api/workspace/:projectId/files` | admin | Coding workspace browser (not tenant workspace) |
| GET | `/api/workspace/:projectId/file/*` | admin | Stream a file |
| GET | `/api/workspace/:projectId/download` | admin | Zip + download |
| GET | `/api/workflows` | admin | Simple scheduled workflows |
| POST | `/api/workflows` | admin | Create |
| PATCH | `/api/workflows/:id` | admin | Edit |
| DELETE | `/api/workflows/:id` | admin | Delete |
| POST | `/api/workflows/:id/run-now` | admin | Fire outside schedule |
| GET | `/api/workflow-definitions/registry/{search,categories,:id}` | admin | Graph-workflow marketplace |
| POST | `/api/workflow-definitions/registry/:id/install` | admin | Install template |
| GET | `/api/workflow-definitions` | admin | List graph workflows |
| POST | `/api/workflow-definitions` | admin | Create |
| GET | `/api/workflow-definitions/:id` | admin | Read |
| PATCH | `/api/workflow-definitions/:id` | admin | Edit |
| DELETE | `/api/workflow-definitions/:id` | admin | Delete |
| GET | `/api/workflow-definitions/:id/runs` | admin | Run history |
| POST | `/api/workflow-definitions/:id/run` | admin | Fire manually |
| POST | `/api/workflow-definitions/runs/:runId/resume` | admin | Resume paused run |
| POST | `/api/workflow-definitions/runs/:runId/cancel` | admin | Cancel paused run |
| GET | `/api/workflow-definitions/runs/:runId` | admin | One run |
| GET | `/api/analytics/summary` | admin | Aggregated counts |
| GET | `/api/dashboard/briefing?goal=…` | auth (admin or client) | Briefing dashboard stats |
| POST | `/api/browser/visit` | token | Extension reports current URL |
| GET | `/api/browser/current` | token | Last reported URL |
| GET | `/api/browser/recent` | token | Recent URLs |
| GET | `/api/browser/{check-mcp,check-cli}` | token | Environment detection |
| POST | `/api/browser/cli/import` | token | Import CLI session |
| GET | `/api/browser/detections` | token | Service detections |
| GET | `/api/browser/prompt` | token | Pending connector prompt (empty if none) |
| POST | `/api/mcp/connect` | admin + token | Open MCP session |
| POST | `/api/mcp/call` | admin + token | Call MCP tool |
| GET | `/api/mcp/sessions` | admin + token | List sessions |
| GET | `/api/team` | admin | List admin users |
| POST | `/api/team` | admin | **Disabled** — returns 409 until Phase 2.5 |
| DELETE | `/api/team/:userId` | admin | Revoke admin role (rate-limited) |
| GET | `/api/auth/google` | admin | Begin direct-API Google OAuth |
| GET | `/api/auth/google/callback` | admin | OAuth redirect |
| GET | `/api/auth/google/status` | admin | Google token on file? |
