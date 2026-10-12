# What each agent takes off a person's plate

For a non-technical owner thinking about where CodeCraft actually saves time.
Every number labelled "estimate" is a reasonable scenario, not a measurement —
the assumption is spelled out. Nothing here is a guarantee.

---

## Sales department

### Sales Agent

- **Human role it supports:** sales rep or founder doing outreach themselves.
- **Tasks it handles:** finding leads from a web search, drafting
  personalised cold outreach (email and WhatsApp), tracking which contacts
  were reached, drafting Day-4/10/21 follow-ups.
- **Where it beats manual work:** a human sales rep searching, personalising,
  and queuing 10 outreach emails is a 1–2 hour task; the Sales agent produces
  the same drafts in a few minutes. **Estimate:** at 10 leads/day, 5 days/week
  → ~5–10 hours/week saved. **Assumption:** owner is already doing cold
  outreach and would do 10 touches/day.
- **What still needs a person:** every send is approved by the owner. The
  agent does not qualify leads for product fit or price sensitivity.
- **Honest limitations:** quality depends on the quality of the LLM responses;
  the agent drops leads it can't verify a source URL for (visible in the
  "dropped: no source" audit entries).

### Job Verification Agent

- **Supports:** a job hunter sifting through listings.
- **Handles:** scores a job on freshness, company legitimacy, listing
  authenticity, contact validity, relevance, and source reliability. Only
  listings scoring 75+ (configurable) proceed to outreach.
- **Beats manual work:** removes stale listings and ghost postings before any
  outreach goes out. **Estimate:** removes ~20–40% of raw listings. **Assumption:**
  the raw feed is a mix of job boards.
- **Needs a person:** the owner reviews borderline scores on the dashboard.
- **Limitations:** scoring is grounded in web search; the LLM relevance score
  is one input of six, and defaults neutral when the job description is
  missing.

### Response Detection Agent

- **Supports:** anyone running job or sales outreach.
- **Handles:** scans the inbox for replies that match a sent outreach, classifies
  them (positive, negative, meeting request, autoresponder, opt-out, etc.),
  and stops the follow-up sequence when a real reply arrives.
- **Beats manual work:** stops the embarrassing "ignored a yes while sending a
  Day-10 follow-up" case. Also surfaces meeting requests to the Scheduling
  agent automatically.
- **Needs a person:** classifications are visible in the audit log and in the
  pipeline UI, but the owner reviews the plan.
- **Limitations:** autoresponders deliberately do **not** stop the sequence —
  an out-of-office isn't a real reply.

### Job Application Agent

- **Supports:** a job hunter.
- **Handles:** reads an application form, pre-fills it from the applicant
  profile, queues the submission for approval.
- **Beats manual work:** 15–30 minutes per application → ~2 minutes to review
  and approve.
- **Needs a person:** every submission is approved. The agent cannot answer
  essay questions well without a human.
- **Limitations:** some application sites use heavy JavaScript or CAPTCHAs
  that the browser agent can't handle.

---

## Marketing department

### Marketing Agent

- **Supports:** a founder doing their own social.
- **Handles:** drafts a social post or marketing copy on request, grounded in
  a web search where possible.
- **Beats manual work:** a 20-minute draft → ~1 minute. **Estimate:** at
  5 posts/week, ~1.5 hours/week saved.
- **Needs a person:** every post is reviewed and published by the owner.
- **Limitations:** does not run a calendar; does not do design beyond text.

### Content Studio Agent

- **Supports:** a founder preparing an event or launch.
- **Handles:** a full content package in one request — caption, hashtags,
  cover image (via OpenAI image generation), optional YouTube reference
  video. Delivered as a document link.
- **Beats manual work:** typical outside quote for a flyer + caption is
  $20–$100 and 1–2 days turnaround; this is minutes, zero marginal cost
  beyond the image API call. **Assumption:** the business is already paying
  for a designer per campaign.
- **Needs a person:** image quality varies — some generated images need a
  retry.

---

## Customer Support & Communication

### Customer Support Agent

- **Supports:** a founder answering their own customer emails.
- **Handles:** drafts replies to support emails after reading the thread.
- **Beats manual work:** a 10-minute reply → 30 seconds to review and send.
- **Needs a person:** every send is approved. Won't make promises about
  pricing or policy it doesn't have context on.
- **Limitations:** doesn't have access to CRM data unless the business
  profile is set up.

### Personal Assistant Agent

- **Supports:** an owner buried in email.
- **Handles:** triages the inbox — drops emails from your own addresses,
  active outreach threads, system digests, and automated senders; drafts
  replies for messages that genuinely need one; groups by thread.
- **Beats manual work:** removes the "which 20 of these 200 unread actually
  need me" problem. **Estimate:** 30–60 minutes/day → ~5 hours/week.
  **Assumption:** owner handles their own email and gets a few hundred
  messages a week.
- **Needs a person:** every drafted reply is approved.
- **Limitations:** can't read attachments; threads with HTML-heavy formatting
  may need manual review.

### WhatsApp Agent / Telegram Agent

- **Supports:** a business taking customer messages on messaging apps.
- **Handles:** drafts a reply to each incoming customer message. Pings the
  owner if auto-reply is off (the default) or if auto-reply safety blocks
  the draft.
- **Beats manual work:** instant acknowledgement to customers at any hour
  (even if the owner is asleep, the owner is pinged in real time and the
  draft is ready for one tap).
- **Needs a person:** every send is approved unless `*_AUTO_REPLY_ENABLED` is
  on **and** the draft passes risk-keyword + placeholder + daily-limit +
  groundedness checks.
- **Limitations:** doesn't understand photo/voice messages; doesn't know your
  business beyond the business profile.

### Scheduling Agent

- **Supports:** a business that takes meeting bookings.
- **Handles:** reads the current Google Calendar, computes genuinely free
  slots, drafts a times-proposal reply, re-checks the slot is still free at
  booking time (closes the race window), creates the calendar event.
- **Beats manual work:** no more "what times work for you?" ping-pong. One
  reply offers 3–5 real slots.
- **Needs a person:** every proposal and every calendar event is approved —
  calendar invites always require approval, even in otherwise-automatic
  outreach mode.
- **Limitations:** works off a single Google Calendar; multi-calendar merging
  isn't supported.

---

## Strategy & Research

### CEO Agent

- **Supports:** a founder thinking through tradeoffs.
- **Handles:** co-founder-style strategy analysis — weighs the real tradeoffs
  of a decision given the business's constraints and ends with a clear
  recommendation.
- **Beats manual work:** faster than a 30-minute self-journaling session;
  gives a devil's-advocate reading.
- **Needs a person:** judgment calls remain the owner's. The agent gives
  reasoning; it doesn't commit to anything.
- **Limitations:** doesn't know the business's internal numbers unless the
  owner provides them in chat.

### Research Agent

- **Supports:** anyone who needs a quick, cited summary of a topic.
- **Handles:** one request → multi-source web research with real citations.
- **Beats manual work:** replaces a 30–60 minute browsing session with a
  5-minute read.
- **Needs a person:** facts should be spot-checked before quoting them in
  anything high-stakes.
- **Limitations:** depends on Tavily search quality + the LLM's reading of
  the pages.

### Briefing Agent

- **Supports:** a founder who wants to stay on top of a topic every day
  without reading a dozen sites.
- **Handles:** recurring brief (daily or weekly) combining several topics
  and/or named websites into one cited document. Compares against the
  previous brief and calls out what's new or escalating.
- **Beats manual work:** a 15–20 minute daily news scan → a 2-minute read of
  one `.docx`. Opt-in WhatsApp delivery means it arrives on your phone.
- **Needs a person:** nothing to approve — this is output.
- **Limitations:** quality of synthesis depends on the LLM; stale sources
  still land in the brief if they still rank in search.

---

## Development & Operations

### Coding Agent

- **Supports:** a non-engineer who needs a quick coded artifact (a flyer, a
  landing page, a spreadsheet template).
- **Handles:** writes files, lists project files, zips the result for
  download.
- **Beats manual work:** replaces a $50–$200 freelancer quote for a one-page
  HTML flyer; delivers in minutes.
- **Needs a person:** the owner reviews the zip and uses it.
- **Limitations:** no live preview inside the UI yet; the zip is downloaded
  and run locally.

### Computer Operator Agent

- **Supports:** a solo founder whose "Downloads" folder is 30 GB of chaos.
- **Handles:** find large files, find files you haven't touched in a year,
  find duplicates, open specific files/folders, delete to the Recycle Bin
  (with approval). Hard allowlist of root paths and apps.
- **Beats manual work:** 1-click "delete these 40 old installers" vs. a
  tedious manual sweep. Visibility into *why* your disk is full.
- **Needs a person:** every delete is approved; the Recycle Bin is reversible
  for 30 days (standard Windows behaviour).
- **Limitations:** Windows-only path handling; refuses executables for
  `openFile`; refuses to delete an allowed root itself.

### Browser Agent

- **Supports:** a founder who wants a page summarized or a workflow screenshot
  taken.
- **Handles:** navigates to a URL, reads the rendered content, takes a
  screenshot. Driven by a browser extension so it uses the owner's logged-in
  session.
- **Beats manual work:** replaces the "open the page, scroll, copy, paste"
  loop with one request.
- **Limitations:** needs the browser extension installed and the shared
  `BROWSER_EXTENSION_TOKEN` configured on both sides.

---

## Summary table

| Agent | Supports | Core time saved per week (estimate) | Approval needed? |
|---|---|---|---|
| Sales | Outreach to leads | 5–10 h/week at 10 touches/day | Yes, every send |
| Job Verification | Job hunter | Drops 20–40% of stale listings | No |
| Response Detection | Outreach follow-up | Stops wrong-moment follow-ups | No |
| Job Application | Job hunter | 15–30 min → 2 min per app | Yes, every submission |
| Marketing | Social copy | 1.5 h/week at 5 posts/week | No |
| Content Studio | Event/launch content | $20–$100 per content package avoided | No |
| Customer Support | Support emails | 10 min → 30 s per reply | Yes, every send |
| Personal Assistant | Inbox triage | ~5 h/week | Yes, every reply |
| WhatsApp / Telegram | Customer messaging | Instant acknowledgement | Default yes |
| Scheduling | Meeting booking | Removes ping-pong | Yes, every event |
| CEO | Strategy sounding board | Replaces a 30-min self-journal | No |
| Research | One-off research | 30–60 min → 5 min | No |
| Briefing | Daily news scan | 15–20 min/day = ~2 h/week | No |
| Coding | Small coded artifacts | $50–$200 freelance quote avoided | No |
| Computer Operator | Disk cleanup | Faster than manual sweep | Yes, every delete |
| Browser | Page summaries | Removes "open-scroll-copy" loop | No |

All time/money numbers are estimates based on typical SMB workflows — your
mileage will vary.
