# Leads and follow-ups

**Where:** Work -> Leads.

## What it does

- **Every WhatsApp contact becomes a lead** (status *New*) the first time they message. Your own number never does.
- **Ian fills in the details as he chats.** That means their name, type of business, what they need (website, e-commerce, design, AI assistant, SEO), budget or timeline, and location, plus a one-line summary.
  - He picks these up from his normal reply, so there is no extra AI cost.
  - He asks at most one question per reply, and only when it fits. It never feels like a form.
- **Statuses:** New, Interested, Quote sent, Won, Lost, Not interested.
  - Ian moves a lead from New to Interested, or to Not interested.
  - *Quote sent* is set when a reply with a price actually goes out. Ian never sends prices on his own, so that is always one you approved or wrote yourself.
  - Won and Lost are yours. Ian never changes a status you set to Won or Lost.
- **Scraped leads** from your Google Sheet show in the same list with Source = *Scraped*.
  - The Sheet is only read, never changed.
  - Notes and statuses you set on scraped leads are saved in CodeCraft.
  - Scraped leads are **never** messaged automatically.
- **On the page:** search, filters (status, need, source), notes, and a CSV export of the rows you're looking at.

## Follow-ups (WhatsApp leads only)

A lead who goes quiet after *our* last message gets a short, personal follow-up based on the conversation:

| | When |
|---|---|
| 1st follow-up | 2 days after the conversation stopped |
| 2nd (last) follow-up | 5 days after their last message |

Both delays are editable under **Follow-up settings**. There is never a third follow-up.

A follow-up is never sent:
- outside 8am–7pm Ghana time, or on a Sunday;
- to someone who replied STOP, or is Not interested, Won or Lost;
- while one of their replies is waiting for your approval;
- to a scraped lead, or to anyone who hasn't messaged you first.

Follow-ups go through the same paced queue as outreach: 30–90 seconds apart, and they count toward `DAILY_WA_LIMIT`.

**Ask me before sending follow-ups** is on by default. With it on, each follow-up waits on your Tasks page and you get an alert. A follow-up that mentions a price, a promise and so on always waits, even with the setting off.

## Alerts

- **Hot lead:** you get an alert when someone asks about price, wants to start, or mentions a deadline. You get at most one per lead per day.
- **Daily summary** (default 7pm Ghana time): new leads, replies from earlier leads, and follow-ups sent. It is skipped on days with nothing new.
- Alerts go to WhatsApp (`OWNER_WHATSAPP_NUMBER`) and Telegram, with email if neither works.

## Setup

1. Back up the database:

   ```
   cd backend
   node scripts/backup-db.js --label=before-leads
   ```

2. In Supabase, open **SQL Editor** and paste `backend/database/migrations/0008_leads.sql`. Click **Run**.
3. Deploy. Leads start filling in from the next WhatsApp message.

## Code

| Area | Files |
|---|---|
| Logic | `backend/core/leads/index.js` |
| Storage | `backend/core/leads/store.js` |
| API | `backend/api/leadRoutes.js` (`/api/leads`) |
| Page | `frontend/src/pages/Leads.jsx` |
| Tests | `backend/tests/leads.test.js` |

The follow-up and summary jobs run from the scheduler, doing real work every 5 minutes.
