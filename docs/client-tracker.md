# Client Tracker (Gmail + Google Sheets + Google Calendar)

The Client Tracker sends outreach from your Gmail, watches for replies, books meetings on your Google Calendar and keeps every lead's state in your Google Sheet. The sheet is the single source of truth: change a lead's Stage there and the agent follows it.

Code: `backend/core/clientTracker.js`, routes in `backend/api/clientTrackerRoutes.js`, page **Client Tracker** in the sidebar.

---

## 1. Connect your Google account

The tracker uses the Gmail, Google Sheets and Google Calendar connections your workspace already has, through Composio. Each workspace uses only its own accounts.

1. Go to **Connections** and connect **Gmail**, **Google Sheets** (then choose your sheet) and **Google Calendar**. Sign in with the same Google account each time.
2. Open **Client Tracker**, check the settings (daily cap, timezone, working hours, meeting length, follow-up time) and click **Set up tracker**.

Setup adds three tabs to your connected sheet (**Client Tracker**, **Activity Log**, **Do Not Contact**) and creates the Gmail label **CodeCraft Outreach**. Any tabs already in the sheet, such as your Sales Manager leads tab, are left alone.

### Google Cloud console

With Composio's managed sign-in (the default), you don't need a Google Cloud project, API keys or an OAuth consent screen. Composio's Google app is already verified, and your tokens are stored and refreshed by Composio. CodeCraft never sees or stores them.

If you would rather use **your own Google OAuth app** inside Composio, for example to show your own app name on the consent screen:

1. In [console.cloud.google.com](https://console.cloud.google.com), create or pick a project. Make sure billing isn't blocking it: the old service-account project was refused with `SERVICE_DISABLED`.
2. **APIs & Services → Library**: enable the **Gmail API**, **Google Sheets API** and **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: choose External and add the scopes below. While the app is in **Testing**, add each Google account that will connect as a test user (100 max). Publishing for anyone needs Google's restricted-scope verification for `gmail.readonly` / `gmail.modify`.
4. **Credentials → Create credentials → OAuth client ID** (Web application). Add Composio's redirect URI, shown when you create an auth config in Composio: `https://backend.composio.dev/api/v1/auth-apps/add`.
5. In the Composio dashboard, create an auth config for each toolkit (gmail, googlesheets, googlecalendar) using your client ID and secret, and limit each to the scopes below. CodeCraft picks it up automatically: it tries Composio-managed configs first, then any other enabled config for the toolkit.
6. Keep the client secret in Composio only. Never commit it, and don't put it in the CodeCraft repo or chat.

### Scopes and why each is needed

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/gmail.send` | Send outreach, follow-ups, meeting options and the opt-out confirmation. |
| `https://www.googleapis.com/auth/gmail.readonly` | Read replies in threads labelled "CodeCraft Outreach", and read your own address so your manual replies can be detected. |
| `https://www.googleapis.com/auth/gmail.labels` | Create the "CodeCraft Outreach" label. |
| `https://www.googleapis.com/auth/gmail.modify` | Apply that label to each email the agent sends. Add/remove-label calls need modify, and nothing is deleted. |
| `https://www.googleapis.com/auth/spreadsheets` | Read and update the tracker tabs. `drive.file` can't be used because it doesn't cover a sheet you created yourself and then picked by link. |
| `https://www.googleapis.com/auth/calendar.events` | Create the meeting with a Google Meet link and invite the lead. |
| `https://www.googleapis.com/auth/calendar.freebusy` | Check when you're busy over the next 7 days, without reading event details. |

Composio's **managed** apps ask for somewhat wider scopes than this list. Use your own OAuth app (above) if you need exactly these.

---

## 2. The sheet

**Client Tracker** tab, columns A–H (yours):

`Name | Email | Company | Stage | Last Contact Date | Next Follow-up Date | Calendar Event Link | Notes`

Stage values: Contacted, Replied, Booked, Follow-up Sent, Manual Handling, Needs Review, Do Not Contact, Closed. A blank Stage means a new lead that hasn't been emailed yet.

Columns I–O are the agent's own bookkeeping and live in the sheet so nothing is kept anywhere else:

| Column | Meaning |
|---|---|
| High Value | `yes` means every send to this lead waits for your approval. |
| Follow-ups Sent | 0–2. |
| Thread ID | The Gmail thread the agent started. |
| Agent Message IDs | The messages the agent sent, used to tell them apart from yours. |
| Proposed Slots | Meeting times offered and not yet confirmed. |
| Automation | Blank = on. `paused` / `stopped` / `awaiting approval` = the agent won't email this lead. Clear it to hand the lead back. |
| Last Seen At | The newest message already handled. |

**Activity Log** tab: `Timestamp | Lead Email | Action | Result | Details`. One row for every send, block, import, classification, booking and error. Reply text is never written here, only the outcome.

**Do Not Contact** tab: `Email | Date Added | Reason`. You can add addresses by hand.

---

## 3. What the agent does

**Import:** paste leads on the Client Tracker page (`Name, email, company, high-value`), or call `POST /api/client-tracker/import`. Addresses already in the tracker are skipped, and addresses on Do Not Contact are never added, on every import.

**Outreach:** sends to leads with a blank Stage, using your subject and body (`{{first_name}}`, `{{name}}`, `{{company}}`). Each email ends with: *If you'd rather not hear from us, just reply "stop" and we won't email you again.* After sending, the lead is set to Stage = Contacted with today's date and a follow-up in 3 days, and the email gets the "CodeCraft Outreach" label.

**Replies:** checked every 15 minutes.
- The agent lists only threads matching `label:"CodeCraft Outreach"`, and opens only the ones it started for a lead in the sheet. Nothing else in your inbox is fetched, logged or stored.
- A reply from the lead's own address sets Stage = Replied and is classified by AI:
  - **Opt-out** (stop, unsubscribe, remove me, …): Stage = Do Not Contact, address added to the tab, follow-ups cancelled, and one reply sent: *Understood, you won't hear from us again.* Clear phrases are caught without the AI.
  - **Unclear opt-out:** Stage = Needs Review, automation paused until you decide.
  - **Interested:** checks your calendar for the next 7 days and emails 3 open slots within working hours (weekdays, one per day where possible). When the lead picks one, the agent creates the event with a Google Meet link, invites them, and sets Stage = Booked plus the event link.
  - **Question:** note "Asked a question - needs your answer", automation paused.
  - **Not interested:** Stage = Closed.
- A reply in the thread from a **different address** isn't treated as the lead. The note says "Possible match, needs review", automation is paused, and the agent waits for you.
- **You replying** in a labelled thread yourself sets Stage = Manual Handling and pauses automation, so the agent never sends over your conversation.

**Follow-ups:** once a day at the follow-up time, in your timezone. Replies are checked first. Leads in Contacted or Follow-up Sent with no reply after 3 days get a short follow-up and Stage = Follow-up Sent, with the next one scheduled. Follow-ups stop after 2.

### Safety rules (every send)

1. **Do Not Contact** tab checked first. A listed address is blocked and logged.
2. A paused lead (Manual Handling, Needs Review, Closed, Automation not blank) is blocked.
3. A **High Value** lead gets an approval request on the **Tasks** page instead of a send. Approving it sends the email, still subject to checks 1, 2 and 4.
4. **Daily email cap** (default 30, set on the page). Once it's reached, remaining sends are blocked and logged.
5. Composio and Google errors are retried with backoff: up to 3 tries on rate limits and temporary 5xx errors. A send is retried only when Google refused it with a rate limit, so a lead is never emailed twice.

---

## 4. Settings and environment

Per-workspace settings are set on the Client Tracker page and stored in the `clienttracker` row of `workspace_connections`. Server defaults (Render, optional):

| Variable | Default | Meaning |
|---|---|---|
| `CLIENT_TRACKER_DAILY_CAP` | 30 | Default daily email cap. |
| `CLIENT_TRACKER_TIMEZONE` | UTC | Default timezone. |
| `CLIENT_TRACKER_WORK_START` / `_WORK_END` | 09:00 / 17:00 | Default working hours. |
| `CLIENT_TRACKER_MEETING_MINUTES` | 30 | Default meeting length. |
| `CLIENT_TRACKER_FOLLOWUP_TIME` | 09:00 | Default time of the daily follow-up run. |
| `CLIENT_TRACKER_REPLY_CHECK_MINUTES` | 15 | Reply-check interval; 0 turns automatic checks off. |

No Google secrets are needed in CodeCraft's environment; Composio holds the tokens (`COMPOSIO_API_KEY` is already set).

## API

All routes are under `/api/client-tracker` and need a signed-in workspace admin.

| Method | Path | Body |
|---|---|---|
| GET | `/status` | none |
| GET | `/activity?limit=50` | none |
| POST | `/setup` | settings |
| POST | `/settings` | settings (`enabled: false` turns automation off) |
| POST | `/import` | `{ leads: [{ name, email, company, highValue, notes }] }` |
| POST | `/outreach` | `{ subject, body, limit }` |
| POST | `/check-replies` | none |
| POST | `/follow-ups` | none |
