# User guide

Plain-language walkthrough for a business owner using CodeCraft. No code.

---

## 1. Logging in

Sign in with the email and password you were given. If you forget the
password, use the **Forgot password?** link on the sign-in page.

If the Dashboard says "No role on file", your admin role hasn't been granted
yet — ask whoever set up CodeCraft to grant it on the Team page.

---

## 2. The five departments

Each department contains a few specialist agents. See
[agents.md](agents.md) for the full table.

| Department | Covers |
|---|---|
| **Sales** | Lead generation, cold outreach, follow-ups, job hunting |
| **Marketing** | Social posts, content packages |
| **Support** | Email, WhatsApp, Telegram, meeting bookings, inbox triage |
| **Strategy** | Strategy writing, research, recurring briefings |
| **Development** | Small coded files, computer-file management, web pages |

A chat window labelled **Chat with the assistant** routes whatever you type
to the right department automatically.

---

## 3. Running a task

**(a) Chat with the assistant** — the fastest path. Examples:

- *"Draft a WhatsApp message to Kofi asking if the delivery arrived."*
- *"Find three cafes in East Legon that could use a website."*
- *"Give me a brief on healthcare news in Ghana this week."*
- *"Reply to the latest customer email about broken shipping."*

**(b) Console** — if you want to pick the department explicitly, open that
department's page and type there.

### What happens next

- Instant results (research, strategy, drafts, content packages) appear in
  the chat.
- Anything that **sends a message, deletes a file, or books a meeting**
  becomes a pending approval card on the **Tasks** page.

---

## 4. Approving or rejecting drafts

Each card shows the agent, the tool it wants to use, the exact payload, and
Approve / Reject / Edit buttons. **No agent bypasses this step.** The only
exception is per-channel auto-reply for WhatsApp or Telegram, which is off
by default and still refuses to send anything that mentions refunds,
complaints, or placeholder text.

---

## 5. Owner-notification emails

Some agents hand work back to you. For example, when the Sales agent can't
auto-apply for a job, it emails you a batch of listings to apply to by
hand (subject: `[CodeCraft/System] Manual apply queue`).

These emails only ever go to the one address configured as the owner email.

---

## 6. Workflows (recurring work)

Open the **Workflows** page → **New workflow**. Give it a name, a goal
(the exact prompt as if you were typing it in chat), and a schedule:

- **Interval** — every N minutes
- **Daily** — once a day at a specific time (optional days of the week)
- **Folder watch** — fires when a new video file lands in a watched folder

Every scheduled run still goes through the approval gate. Toggle Enabled
on/off any time.

Scheduled workflows only run while the server is on. Low-cost hosting
plans sleep the server after a quiet period; paid plans keep it on.

---

## 7. Writing good requests

Short, specific, name the person / channel / time.

Weak: *"Reach out to clients."*
Strong: *"Draft a WhatsApp message to +233 20 123 4567 asking if the June
invoice got through."*

Weak: *"Research AI."*
Strong: *"Daily brief on healthcare policy news in Ghana, from the past 24
hours, with sources."*

If an agent asks a clarifying question, answer it in the next chat message.

---

## 8. Workspace health (admin only)

Settings → **Workspace health** shows any time the system wrote or read data
without knowing which workspace it belonged to. A healthy state is empty
(apart from expected scheduler reads). Unexpected entries are a bug worth
reporting. The **Clear log** button resets the panel.
