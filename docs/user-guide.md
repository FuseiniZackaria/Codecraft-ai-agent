# User guide

A plain-language walkthrough for a business owner using CodeCraft. No code here.

---

## 1. Logging in

Open the CodeCraft web page in your browser and sign in with the email and
password you were given.

- If you forget your password, click **Forgot password?** on the login page and
  follow the email link to reset it.
- If the page says "No role on file" or you can't see the Dashboard after
  signing in, the admin role hasn't been granted to your account yet. Ask
  whoever set up CodeCraft to grant it on the Team page.

Once signed in, you land on the **Dashboard** — a set of tiles, one per
department.

---

## 2. The five departments and their agents

CodeCraft is organised like a small company. Each department contains a few
specialist agents.

| Department | What it covers | Agents inside |
|---|---|---|
| **Sales** | Lead generation, cold outreach, follow-ups, job hunting | Sales, Job Verification, Response Detection, Job Application |
| **Marketing** | Social posts, content packages, image cover art | Marketing, Content Studio |
| **Customer Support & Communication** | Replies to customers on email, WhatsApp, Telegram; booking meetings; inbox triage | Customer Support, Personal Assistant, WhatsApp, Telegram, Scheduling |
| **Strategy & Research** | Co-founder-style strategy thinking, deep research, recurring briefings | CEO, Research, Briefing |
| **Development & Operations** | Build small coding tasks, operate your computer, browse websites | Coding, Computer Operator, Browser |

Click a department tile to see each agent and what it can do. There's also a
chat window labelled **Chat with Ian** (your assistant). Ian routes whatever
you type to the right department automatically — you don't have to know which
agent handles what.

---

## 3. Running a task

Two ways to start work:

**(a) Chat with Ian** — the fastest path.
Type what you want in plain English. Examples:

- *"Draft a WhatsApp message to Kofi asking if the delivery arrived."*
- *"Find three cafes in East Legon that could use a website."*
- *"Give me a brief on healthcare news in Ghana this week."*
- *"Reply to the latest customer email about broken shipping."*

Ian figures out which agent to use, drafts the work, and either shows you the
result in chat or queues it for approval.

**(b) Console** — if you want to be explicit about which department or agent
should handle it, open the department page and type the request there.

### What happens next

- **Instant results** (research, strategy, drafts, content packages) appear in
  chat immediately.
- **Anything that sends a message, deletes a file, or books a meeting** does
  **not** happen immediately. CodeCraft puts it in the **Tasks** page as a
  pending approval card.

---

## 4. Approving or rejecting drafts

Click **Tasks** in the sidebar.

Each pending card shows:

- Which agent drafted it
- What tool it wants to use (`gmail.sendEmail`, `whatsapp.sendMessage`,
  `googlecalendar.createEvent`, `computer.deleteToRecycleBin`, etc.)
- The exact payload — the recipient, subject, body, times, or files
- An **Approve** and a **Reject** button

If the draft looks right: click **Approve**. The tool runs, the recipient
gets the message, and the card moves to the "done" column.

If the draft is off: click **Reject**. Nothing is sent. If you want to adjust
the wording, use the **Edit** button to tweak the body before approving.

**No agent ever bypasses this step.** Even the automated workflows (next
section) only pre-approve on your explicit opt-in and only under strict
conditions.

---

## 5. Manual-work emails

Some agents hand work back to you instead of running it themselves. For
example, the Sales agent, when it can't auto-apply for a job, bundles a list
of jobs you still need to apply to by hand and emails them to you with the
subject **[CodeCraft/System] Manual apply queue**.

If auto-reply is turned off (the default), WhatsApp and Telegram agents also
ping you about new customer messages that are waiting for you.

These owner-notification emails only ever go to the **one address** you
configured as the owner email — not to anyone else. The code enforces that.

---

## 6. Saving a task as a workflow (recurring work)

Any goal you repeat can become a **workflow**: a saved request that runs on a
schedule.

Open the **Workflows** page and click **New workflow**.

- **Name** — anything meaningful ("Daily politics brief")
- **Goal** — the exact prompt as if you were typing it in chat
- **Schedule type:**
  - **Interval** — "every N minutes" (e.g. every 60 minutes)
  - **Daily** — once a day at a specific time, with optional days of the week
  - **Folder watch** (advanced) — fires when a new video file lands in a watched
    folder, used by the video-editing agent
- **Enabled** — toggle on/off any time; disabled workflows don't run

The scheduler checks for due workflows every minute. Each run goes through
the same approval gate — a daily sales workflow drafts and queues, it never
sends on its own.

### Turning a workflow off

Open **Workflows**, flip the Enabled toggle to **Off**. The workflow stops
running immediately. Turn it back on when you need it. Deleting a workflow
removes it permanently.

---

## 7. Writing good requests

Short, specific, name the person/channel/time.

**Weak:** "Reach out to clients."
**Strong:** "Draft a WhatsApp message to +233 20 123 4567 asking if the June
invoice got through."

**Weak:** "Make a flyer."
**Strong:** "Content package for a weekend brunch at The Patio Lounge, East
Legon, Saturday 11am to 3pm — one Instagram caption, three hashtags, one cover
image."

**Weak:** "Research AI."
**Strong:** "Daily brief on healthcare policy news in Ghana, from the past 24
hours, with sources."

If an agent asks a clarifying question, answer it in the next chat message —
the whole conversation is kept together.

---

## 8. What Ian can do

Ian is a shortcut, not a separate brain. Ian:

- Reads your plain-English request
- Picks the right agent/department
- Starts the task
- Shows you the result or the approval card

Ian **cannot**:

- Send anything without approval (not even on your behalf)
- Make up facts — if a research agent doesn't find a source, it says so
- Access anything outside the integrations you've connected

If Ian seems to pick the wrong agent, say so — "no, use the Sales agent" — and
re-run.

---

## 9. Workspace health (admin only)

Settings → **Workspace health** shows any time the system wrote or read data
without knowing which workspace it belonged to. In a healthy state, the panel
shows only expected system entries (the scheduler reading every workspace's
workflows, which is intentional). Unexpected entries indicate a bug worth
reporting.

The **Clear log** button wipes the panel so you can start fresh after a fix.
