# Selling the WhatsApp agent to many businesses

Each client business is its own **workspace**, with its own WhatsApp number,
knowledge base, agent instructions, leads, settings and alerts. Nothing crosses
between them.

## Two tiers

| | Tier 1 - Reply only (WAHA) | Tier 2 - Outreach (Meta official API) |
|---|---|---|
| How the number is linked | QR code / pairing code (WhatsApp Web) | Phone number ID + access token from Meta |
| Replies to customers who write in | Yes, automatically | Yes, automatically (free text within 24 h) |
| Messages someone first | **Never** - even if you approve it | Only an **approved template**, only to **opted-in** contacts |
| Set on | Settings -> Clients -> Settings -> Tier | Tier = Outreach, connection = Meta |

New client businesses start as **Tier 1**. Your own workspace (APP_OWNER_EMAIL)
keeps working exactly as before (outreach on your own number, no warm-up).

## Adding a client

1. **Settings -> Team -> Add admin**, "new workspace" - the client gets their own business.
2. **Settings -> Clients** (only you see it): find the business.
   - Tier 1: click **Link WhatsApp** -> **Show QR code**, and scan it with the
     client's phone (or use the pairing code). Or the client links it
     themselves on Toolbox -> Connections.
   - Tier 2: set connection = Meta and tier = Outreach, then the client enters
     their Meta details on Toolbox -> Connections (WhatsApp Meta / Twilio box).
     Add their approved templates and opted-in contacts on the Clients page.
3. The client fills in Settings -> Profile, Agent instructions, Q&A, Products,
   and **Settings -> WhatsApp** (alert number, town, language).

## Protection against bans (all automatic)

- A message only ever goes out from **its own business's number**.
- Tier 1 numbers only message people who messaged them first.
- **Daily limits per number** (auto-replies: AUTO_REPLY_DAILY_LIMIT, or per
  client on the Clients page; outreach: DAILY_WA_LIMIT).
- **Warm-up** for a newly linked number: 5 outreach messages a day for 3 days,
  then 10 until day 7, then 15 until day 14 (adjustable per client).
- "typing..." and a 2-6 s pause before every reply; 30-90 s between outreach messages.
- **Copy-paste check**: at most 3 near-identical free-text messages per number per day.
- STOP / START always respected; at most 10 auto-replies per customer per hour.
- **Lost or banned number**: the business is emailed and you are alerted at once
  (Telegram / your WhatsApp / email). WAHA itself not answering for ~6 minutes
  alerts you too, because that takes every client offline.

## Alerts

- A client's alerts (held replies, voice notes, hot leads, daily summary) go to
  **their** alert number - sent from their own WhatsApp - or their business email.
- Your Telegram and OWNER_WHATSAPP_NUMBER only get **your** workspace's alerts,
  plus "a client's WhatsApp disconnected" and "the WhatsApp server is down".

## Server settings (Render -> backend -> Environment)

- `WAHA_MULTI_SESSION=true` - required for more than one number.
- `APP_OWNER_EMAIL` - your login email (decides who sees the Clients page).
- Optional: `WA_ALERT_SESSION`, `META_APP_SECRET` (see backend/.env.example).

## Capacity

WAHA runs the light GOWS engine. Watch Render -> WAHA service -> Metrics ->
Memory after linking 2-3 numbers; move the WAHA service to a bigger instance
before it passes ~70%.

## Database safety net

Migration 0010 turns on row level security for every table, so the public key
inside the website can't read any data directly. Check it any time:

    node backend/scripts/check-rls.js
