# Agents reference

Every agent registered in `backend/agents/registry.js`. "Needs approval"
means the tool call is irreversible and goes through the Tasks-page gate.

| Agent key | Department | What it does | Needs approval? |
|---|---|---|---|
| `sales` | Sales | Drafts outreach emails and WhatsApp messages; finds leads via web search; drafts single-lead outreach | Every send |
| `job-verification` | Sales | Scores a raw job opportunity on freshness, company legitimacy, listing authenticity, contact validity, relevance, source reliability | No (read-only) |
| `response-detection` | Sales | Scans the inbox for replies to sent outreach, classifies them, stops the follow-up sequence on a real reply (scheduler-driven; off by default) | No (classification only) |
| `job-application` | Sales | Reads an application form, pre-fills from the applicant profile, queues the submission | Every submission or email |
| `marketing` | Marketing | Drafts social posts and marketing copy grounded in a web search where possible | No (publishing is the owner's step) |
| `content-studio` | Marketing | Full content package: caption, hashtags, cover image (via OpenAI image), optional YouTube reference | No |
| `support` | Support | Drafts replies to customer support emails | Every email |
| `personal-assistant` | Support | Triages the inbox (drops own emails, outreach threads, system digests, automated senders), drafts replies | Every reply |
| `whatsapp` | Support | Drafts replies to inbound WhatsApp messages; pings the owner. Optional auto-reply off by default | Yes, unless `WHATSAPP_AUTO_REPLY_ENABLED=true` and the draft passes safety |
| `telegram` | Support | Same shape as `whatsapp` with `telegram.sendMessage` | Yes, unless `TELEGRAM_AUTO_REPLY_ENABLED=true` and safe |
| `scheduling` | Support | Reads Google Calendar, computes real free slots, drafts a times-proposal reply, re-checks the slot before booking | Every proposal and every event — always |
| `ceo` | Strategy | Co-founder-style strategy writing with real tradeoffs and a clear recommendation | No |
| `research` | Strategy | Deep multi-source web research with citations | No |
| `briefing` | Strategy | Combines multiple searches and specific pages into one cited brief; compares against the previous run for the same goal; produces a `.docx` report. Opt-in per-workflow WhatsApp delivery | No (opt-in delivery documented) |
| `coding` | Development | Small coded files (flyer, landing page, template); zips the project for download | No |
| `computer-operator` | Development | Searches, inspects, opens, finds large / old / duplicate files; deletes to Recycle Bin behind a hard allowlist of roots and apps | Every delete |
| `browser` | Development | Navigates to a URL, reads the rendered page, takes a screenshot | No |

**Pattern — approval tasks.** When an agent needs an irreversible tool, it
calls `BaseAgent.createApprovalTask()` which builds a `pending_approval`
task with the saved tool call + payload + `workspace_id`. On human
approval, `orchestrator.approveTask()` dispatches the tool with
`approvedTaskId`, and the relevant guard verifies the id matches, the
recipient hasn't been tampered with, and the send isn't a duplicate.

**Background jobs** are off by default. `OUTREACH_RESPONSE_CHECK_INTERVAL_MINUTES`
turns the response-detection sweep on; `OUTREACH_FOLLOWUP_CHECK_INTERVAL_MINUTES`
turns the Sales follow-up queue on. Both default to `0`.
