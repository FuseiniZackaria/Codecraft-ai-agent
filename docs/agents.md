# Agents reference

Every agent registered in `backend/agents/registry.js`, grouped by department.
Each entry lists: what it does, which tools it declares, what triggers it,
what needs approval, and the background jobs it runs (if any).

An **irreversible** tool call never runs directly — the agent builds a
`pending_approval` task and the human clicks Approve or Reject.

---

## Sales

### `sales` — Sales Agent

- **Role:** draft outreach, build lead cards from scratch, handle single-lead
  outreach.
- **Tools:** `websearch.search`, `gmail.sendEmail` (irreversible),
  `whatsapp.sendMessage` (irreversible), `social.prepareDM`.
- **Example requests:** *"Find three cafes in Osu that could use a website."*,
  *"Draft a sales email to kofi@example.com about our website service."*
- **Needs approval:** every email, every WhatsApp send, every social DM.
- **Background job:** `OUTREACH_FOLLOWUP_CHECK_INTERVAL_MINUTES` → queues
  Day-4 / Day-10 / Day-21 follow-ups for sent outreach that hasn't been
  responded to. Default off (0 min).
- **Overrides:** `plan`, `reflect`, `run`.

### `job-verification` — Job Verification Agent

- **Role:** scores a raw job opportunity on freshness, company legitimacy,
  job-listing authenticity, contact validity, relevance, and source
  reliability.
- **Tools:** `websearch.search`.
- **Example request:** called upstream from `outreachPipeline.processOpportunity`.
- **Needs approval:** none (read-only; downstream outreach is gated separately).

### `response-detection` — Response Classification Agent

- **Role:** scans the inbox for replies to previously-sent job outreach,
  classifies them, and updates the pipeline so the follow-up sequence stops at
  the right moment.
- **Tools:** `gmail.readInbox`.
- **Needs approval:** none (classification only).
- **Background job:** `OUTREACH_RESPONSE_CHECK_INTERVAL_MINUTES`. Default off.

### `job-application` — Job Application Agent

- **Role:** reads a job-application form, pre-fills it from the applicant
  profile, and queues the submission for approval.
- **Tools:** `browser.navigate`, `browser.readPage`, `gmail.sendEmail` (irreversible).
- **Needs approval:** every actual submission or email.

---

## Marketing

### `marketing` — Marketing Agent

- **Role:** drafts social posts and marketing copy. Grounds claims in a web
  search when possible.
- **Tools:** `websearch.search`.
- **Example requests:** *"Instagram caption for a new menu launch."*,
  *"Three LinkedIn posts about our construction service."*
- **Needs approval:** none (output only; publishing is the owner's step).
- **Overrides:** `plan`.

### `content-studio` — Content Studio Agent

- **Role:** produces a full content package — caption, hashtags, cover image,
  optional YouTube reference.
- **Tools:** `websearch.search`, `youtube.search`,
  `imagegen.generateImage`.
- **Example requests:** *"Content package for a weekend brunch event at The
  Patio Lounge."*
- **Needs approval:** none (artifacts are generated locally; no publishing).
- **Overrides:** `plan`, `execute`, `reflect`.

---

## Customer Support & Communication

### `support` — Customer Support Agent

- **Role:** drafts replies to customer support emails.
- **Tools:** `gmail.sendEmail` (irreversible).
- **Example request:** *"Reply to the latest customer complaint about broken
  shipping."*
- **Needs approval:** every email.
- **Overrides:** `plan`, `reflect`.

### `personal-assistant` — Personal Assistant Agent

- **Role:** reads the inbox, applies the triage filters (drop your own emails,
  outreach threads, system digests, automated senders), and drafts replies for
  anything that genuinely needs one.
- **Tools:** `gmail.readInbox`, `gmail.replyToThread` (irreversible).
- **Example requests:** *"Triage my inbox."*
- **Needs approval:** every reply.
- **Overrides:** `plan`, `execute`, `reflect`.

### `whatsapp` — WhatsApp Agent

- **Role:** triggered by the WhatsApp webhook on each incoming customer
  message. Drafts a reply and queues it as a pending task.
- **Tools:** `whatsapp.sendMessage` (irreversible).
- **Needs approval:** always, unless `WHATSAPP_AUTO_REPLY_ENABLED=true` **and**
  `autoReplySafety.classifyReplySafety` returns safe.
- **Auto-send limits:** `AUTO_REPLY_MAX_LENGTH`, `AUTO_REPLY_DAILY_LIMIT`.

### `telegram` — Telegram Agent

- Same shape as `whatsapp`, with `telegram.sendMessage` and
  `TELEGRAM_AUTO_REPLY_ENABLED`.

### `scheduling` — Scheduling Agent

- **Role:** when a customer requests a meeting, computes real free slots from
  Google Calendar, proposes them (as an email reply), and books the chosen one.
- **Tools:** `googlecalendar.listEvents`, `googlecalendar.createEvent`
  (irreversible), `gmail.replyToThread` (irreversible).
- **Needs approval:** every calendar event, every reply. **Even in automatic
  outreach mode**, calendar invites always require approval — booking on a
  real person's calendar is a distinct class of commitment.

---

## Strategy & Research

### `ceo` — CEO Agent

- **Role:** thinks through a strategy question like a co-founder — weighs
  tradeoffs, considers the business's actual constraints, ends with a clear
  recommendation.
- **Tools:** `websearch.search`.
- **Example request:** *"Should we focus on WhatsApp sales or email for Q1?"*
- **Needs approval:** none.
- **Overrides:** `plan`.

### `research` — Research Agent

- **Role:** deep research across the web and (optionally) the inbox.
- **Tools:** `gmail.readInbox`, `websearch.search`.
- **Example request:** *"Research the current state of mobile-money fees in
  Ghana."*
- **Needs approval:** none.
- **Overrides:** `plan`.

### `briefing` — Briefing Agent

- **Role:** combines several web searches and/or specific pages into one
  synthesized, cited brief. Memory across runs — compares the current brief
  against the previous one for the same goal and calls out what's new,
  changed, or escalating.
- **Tools:** `websearch.search`, `browser.navigate`, `browser.readPage`.
- **Example request (usually run as a daily workflow):** *"Daily brief on
  Ghana politics news from Myjoyonline, Citinewsroom, and GhanaWeb."*
- **Produces:** a `.docx` file + rows in `briefing_runs` and
  `briefing_articles` (the Intelligence dashboard reads these).
- **Opt-in WhatsApp delivery:** per workflow row — set
  `deliverWhatsappEnabled` + `deliverWhatsappTo` on the workflow.
- **Needs approval:** none (output only; WhatsApp delivery is a per-workflow
  opt-in that bypasses approval by design, documented behaviour).
- **Overrides:** `plan`, `reflect`.

---

## Development & Operations

### `coding` — Coding Agent

- **Role:** builds small coding tasks — writes files, lists project files,
  zips the result for download.
- **Tools:** `filesystem.writeFile`, `filesystem.listFiles`,
  `filesystem.zipProject`.
- **Example request:** *"Build a one-page HTML flyer for the brunch event."*
- **Needs approval:** none (writes land in a sandboxed project folder; the
  user downloads the zip).
- **Overrides:** `plan`, `execute`, `reflect`.

### `computer-operator` — Computer Operator Agent

- **Role:** searches, inspects, and (with approval) deletes files on the
  owner's actual computer. Hard limits via `COMPUTER_ALLOWED_ROOTS` /
  `COMPUTER_ALLOWED_APPS` / `COMPUTER_MAX_DELETE_BATCH`.
- **Tools:** `computer.searchFiles`, `computer.listDirectory`,
  `computer.openFile`, `computer.openFolder`, `computer.findLargeFiles`,
  `computer.findOldFiles`, `computer.findDuplicateFiles`,
  `computer.deleteToRecycleBin` (irreversible), `computer.launchApp`.
- **Safety:** `openFile` refuses executable extensions; `deleteToRecycleBin`
  refuses to delete an allowed root itself, caps batch size, and rejects
  paths outside the allowlist.
- **Example request:** *"Find my duplicate photos."* /
  *"Delete these PDFs."*
- **Needs approval:** every delete.
- **Overrides:** `plan`.

### `browser` — Browser Agent

- **Role:** navigates to a URL, reads the rendered page, takes a screenshot.
  Backed by Playwright through the browser extension.
- **Tools:** `browser.navigate`, `browser.readPage`, `browser.screenshot`.
- **Example request:** *"Visit example.com and summarize the services page."*
- **Needs approval:** none.
- **Overrides:** `plan`.

---

## Approval-task pattern

Every agent above uses `BaseAgent.createApprovalTask()` to queue work.
The task row carries:

- `agent` key, `instruction`, `status='pending_approval'`, `irreversible=true`
- `toolCall: { tool, irreversible: true }`
- `payload` with the exact arguments the tool will receive (recipient, body,
  file paths, slot start/end, etc.)
- `workspace_id`
- Optional `outreach: { recipientEmail, companyName, leadId, campaign }` which
  also seeds a draft `outreach_threads` row keyed by the task id.

On human approval, `orchestrator.approveTask(taskId)`:

1. Verifies the task is still in `pending_approval`.
2. Logs `human/task_approved`.
3. Calls `toolRegistry.call(task.toolCall.tool, task.payload, { role: task.agent, approvedTaskId, workspaceId })`.
4. The relevant guard (`gmail-guard`, `sendGuard`, etc.) verifies the
   `approvedTaskId` matches, the recipient hasn't been tampered with, and
   the send isn't a duplicate.
5. Flips the task to `done` or `failed` and logs the outcome.
