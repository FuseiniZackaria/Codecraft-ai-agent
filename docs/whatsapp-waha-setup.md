# WhatsApp (WAHA) setup guide - Render

This guide takes you from nothing to "a customer messages my WhatsApp and Ian
answers", using only websites (Render and Supabase) and your phone. Nothing to
install on your computer.

**The idea in one picture.** WAHA is like a phone that stays on WhatsApp Web
for you, 24/7, in the cloud. You link your WhatsApp to it once by scanning a QR
code, exactly like opening web.whatsapp.com. CodeCraft (your backend) talks to
WAHA to read and send messages:

```
Your customer  <->  WhatsApp  <->  WAHA (Render, $7/month)  <->  CodeCraft backend (Render)
```

- **WAHA service** (new): a Render "Starter" web service ($7/month). It never
  sleeps, and it has a small disk (like a USB stick) where your WhatsApp login
  is saved, so restarts don't log you out.
- **Backend service** (you have it already): stays on Render's free plan. It
  sleeps after 15 minutes without visitors; an incoming WhatsApp message wakes
  it up, which takes about 30-60 seconds the first time. WAHA keeps retrying
  delivery every 10 seconds for about 2 minutes (a WAHA feature included in the
  free version from 2026.6.1, so in the image below), so nothing is lost - the
  first reply after a quiet period is just a bit slower. If a message ever
  arrives twice, CodeCraft notices and handles it only once.
- **One shared WhatsApp.** By default the whole app has one WhatsApp number:
  one admin connects it, and everyone's agents use it. While it's connected,
  other admins see *"Connected by another admin"* instead of a Connect button.
  (If you later want each admin to have their own WhatsApp, set
  `WAHA_MULTI_SESSION=true` on the backend - the image below supports it.)

> **Use a spare WhatsApp number.** WAHA is not WhatsApp's official Business API.
> WhatsApp can ban numbers that message lots of strangers. CodeCraft protects
> you: outreach only goes to people who messaged you first, never to anyone who
> replied STOP, 30-90 seconds apart, at most `DAILY_WA_LIMIT` (20) a day, and
> auto-replies are capped at 5 per contact per hour. Still, don't use your
> personal number.

---

## Before you start: make two secret keys

You need two long random "passwords" (think of them as two different door keys):

| Key | What it does | Where it goes |
|---|---|---|
| **WAHA API key** | Lets your backend talk to WAHA. Without it, nobody can use your WAHA. | WAHA service **and** backend service (same value) |
| **Webhook secret** | Lets your backend check that incoming messages really come from your WAHA. | Backend service only |

To make each one, open **PowerShell** on your computer (Start menu → type
"PowerShell" → Enter) and run this line. Run it twice, once per key:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```

Each run prints 40 random letters and digits. Copy each into a private note or
password manager and label them "WAHA API key" and "Webhook secret". Never put
them in chat, screenshots, GitHub, or code.

---

## Step 1. Create the WAHA service on Render

Like renting a small always-on computer that runs WAHA.

1. Open https://dashboard.render.com and sign in.
2. Click **+ New** (top right) → **Web Service**.
3. Choose **Existing Image** (instead of a Git repository).
4. **Image URL:** type `docker.io/devlikeapro/waha:gows-2026.10.1` and click
   **Connect**. (No credentials needed - it's a public image.)

   Why this exact name: `gows` is WAHA's light engine built into a small image,
   and the version number "pins" it - like ordering a specific edition of a book
   instead of "whatever's newest", so an update can never surprise you. To
   update later, you change the number yourself (see "Keeping it running").
5. Fill in the form:
   - **Name:** `codecraft-waha` (any name; it becomes part of the web address)
   - **Region:** the same region as your backend service (check your backend's
     page if unsure) - closer means faster.
   - **Instance Type:** **Starter** ($7/month). Not Free: the free type sleeps
     and has no disk, so WhatsApp would keep logging out.
6. **Environment Variables** - click **Add Environment Variable** for each:

   | Key | Value |
   |---|---|
   | `WAHA_API_KEY` | your **WAHA API key** |
   | `WHATSAPP_DEFAULT_ENGINE` | `GOWS` |
   | `PORT` | `3000` |
   | `WAHA_DASHBOARD_USERNAME` | `admin` |
   | `WAHA_DASHBOARD_PASSWORD` | a password you choose (save it in your note) |
   | `WHATSAPP_SWAGGER_USERNAME` | `admin` |
   | `WHATSAPP_SWAGGER_PASSWORD` | the same password |

   Why:
   - `WHATSAPP_DEFAULT_ENGINE=GOWS` makes sure WAHA uses the light engine - the
     other engine runs a whole Chrome browser, too heavy for the Starter plan.
   - `PORT=3000` tells Render which "door" WAHA listens on.
   - The dashboard and Swagger usernames/passwords lock WAHA's own web pages.
     Without them, WAHA makes up random ones and prints them in its log; with
     them, only you can open the dashboard. (The API itself is locked by
     `WAHA_API_KEY` either way.)
7. **Add the disk** - open **Advanced** → **Add Disk**. The disk is like a USB
   stick plugged into WAHA where your WhatsApp login is kept:
   - **Name:** `waha-sessions`
   - **Mount Path:** `/app/.sessions` (type it exactly, including the dot - the
     GOWS image keeps its logins in the same folder)
   - **Size:** `1` GB
8. Leave **Health Check Path** empty. Click **Deploy Web Service**.

**Check it worked:** the service page shows the deploy log scrolling; after a
few minutes the status at the top turns **Live** (green). Copy the address under
the service name - it looks like `https://codecraft-waha.onrender.com`. That's
your **WAHA address**.

Then open `https://YOUR-WAHA-ADDRESS/dashboard` in your browser. It asks for the
dashboard username and password, then for a server connection: enter your WAHA
address and the **WAHA API key**. You should see an empty **Sessions** list. That
proves WAHA runs and the key works.

## Step 2. Create the database tables (Supabase)

Like adding four new drawers to your filing cabinet: one for each linked
WhatsApp, one for messages, one for the outreach queue, one for people who
said STOP.

1. Open https://supabase.com/dashboard and click your CodeCraft project.
2. Left menu → **SQL Editor** → **New query**.
3. On GitHub, open the file
   `backend/database/migrations/0005_whatsapp_waha.sql` in your repo, click
   **Raw**, select everything (Ctrl+A) and copy (Ctrl+C). Paste it into the
   Supabase editor (Ctrl+V).
4. Click **Run** (bottom right).

**Check it worked:** it says **Success. No rows returned**. Then replace the
text with this and click **Run** again:
```sql
select table_name from information_schema.tables
 where table_name in ('whatsapp_sessions','whatsapp_chat_messages','whatsapp_outbox','whatsapp_optouts');
```
You should see **4 rows**. (Running the migration twice is harmless.)

## Step 3. Set the backend's environment variables

Telling your backend where WAHA lives and which keys to use.

1. Render dashboard → click your **backend** service → **Environment** (left menu).
2. Click **Add Environment Variable** (or edit if it already exists) for each:

   | Key | Value |
   |---|---|
   | `WHATSAPP_PROVIDER` | `waha` |
   | `WAHA_BASE_URL` | your **WAHA address** from step 1, e.g. `https://codecraft-waha.onrender.com` (no `/` at the end) |
   | `WAHA_API_KEY` | the same **WAHA API key** as on the WAHA service |
   | `WAHA_WEBHOOK_SECRET` | your **webhook secret** |
   | `DAILY_WA_LIMIT` | `20` |
   | `WA_OUTREACH_REQUIRE_CONSENT` | `true` |
   | `WA_AUTO_REPLY_MAX_PER_CONTACT_HOUR` | `5` |
   | `WHATSAPP_DEFAULT_COUNTRY_CODE` | `233` |

   You do **not** need `WAHA_WEBHOOK_BASE_URL`: the backend already knows its
   own Render address and tells WAHA to send incoming messages to
   `<backend address>/api/webhooks/whatsapp`.
3. Click **Save, rebuild, and deploy**.

The frontend (Vercel) needs no changes.

**Check it worked:** in the backend's **Logs**, after the deploy finishes, look for:
```
[whatsapp] provider waha; outreach queue started (daily limit 20/session)
```

## Step 4. Connect your WhatsApp (scan the QR code)

Like opening WhatsApp Web on a new computer - except the "computer" is WAHA.

1. Open your live CodeCraft site and sign in.
2. Go to **Toolbox → Connections**. At the top is **WhatsApp (your phone)**.
   Click **Connect WhatsApp**. (If the backend was asleep, the first click can
   take up to a minute.)
3. A window with a QR code opens. On the phone with your **spare** WhatsApp:
   - **Android:** WhatsApp → **⋮** (top right) → **Linked devices** → **Link a device**
   - **iPhone:** WhatsApp → **Settings** → **Linked Devices** → **Link a Device**

   Point the camera at the QR code. (The code changes every ~20 seconds; the
   window refreshes it for you.)
4. A few seconds later the window closes by itself and the card shows
   **Connected** with your number.

**Check it worked:**
- On the phone, **Linked devices** lists a new device.
- In the WAHA dashboard (`https://YOUR-WAHA-ADDRESS/dashboard`) a session named
  `default` shows **WORKING**.
- **Survives restarts:** on the WAHA service page click **Manual Deploy →
  Restart service**. After it's Live again, the card still says **Connected**
  with no new scan. (That's the disk doing its job.)

Only one admin connects WhatsApp. Other admins see *"Connected by another
admin"* on this card; the chats show in the Inbox of the admin who connected it.
To hand it over, that admin clicks **Disconnect**, then the other admin clicks
**Connect WhatsApp** and scans.

## Step 5. Test receiving and auto-replies

1. From a **second phone** (or a friend), send a WhatsApp message to your
   linked number, e.g. *"Hi, what are your opening hours?"*
2. In CodeCraft open **Work → Inbox**. Within about 10 seconds (up to a minute
   if the backend was asleep) the conversation appears.
3. Shortly after, the second phone shows **typing...** and then the agent's
   reply. In the Inbox it's labelled *auto-reply*.
   - No reply? Check **Work → Tasks**. Replies the safety check isn't sure about
     (refunds, complaints, legal, anything not covered by your business info)
     wait there for your approval. Approve to send.
   - Auto-replies need your business info filled in (**Settings → General**).

## Step 6. Test sending, outreach, and STOP

1. **Manual reply:** in **Work → Inbox**, open the conversation, type a reply,
   click **Send**. It arrives on the second phone straight away.
2. **New message (outreach):** in the Inbox click **+ New message**, enter the
   second phone's number (`024...` or `+233...` both work) and a short message,
   click **Queue**. It goes out within about 30-90 seconds.
   - This works because the second phone messaged you in step 5. A number that
     never messaged you is refused with *"hasn't messaged your WhatsApp
     first"* - that's the protection working.
   - The queue runs inside the backend, so while the backend sleeps the queue
     waits; it continues when the backend wakes.
3. **STOP:** from the second phone reply `STOP`. It receives one confirmation
   ("You won't receive any more messages from us..."). From now on nothing is
   sent to it automatically - no outreach, no auto-replies. Its messages still
   show in the Inbox, and you can still reply by hand.
4. **START:** from the second phone reply `START`. It gets a confirmation and
   auto-replies work again.

**Check it worked:** the backend **Logs** show lines like
`[whatsapp] sent (waha/default -> 233..., outreach)`,
`[whatsapp] 233... opted out` and `[whatsapp] 233... opted back in`.

---

## Keeping it running

- **WhatsApp disconnected?** (you logged out on the phone, or the phone was
  offline for about 2 weeks) - a red **"WhatsApp was disconnected"** banner
  appears in CodeCraft. Click **Reconnect** and scan again.
- **Updating WAHA:** look up the newest `gows-` tag at
  https://hub.docker.com/r/devlikeapro/waha/tags?name=gows (use one without
  `arm` in the name, e.g. `gows-2026.11.1`). On the WAHA service page →
  **Settings** → **Image URL**, change the version number, click **Save
  Changes**, then **Manual Deploy → Deploy latest reference**. Your login stays
  on the disk.
- **Costs:** WAHA Starter $7/month + the 1 GB disk (Render charges disks per GB;
  check **Billing**). The backend stays free. Upgrading the backend later
  removes the wake-up delay and keeps the outreach queue running all the time.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| WAHA deploy log: "No open ports detected" | Render can't find WAHA's port | Make sure `PORT` = `3000` on the WAHA service, then redeploy |
| WAHA keeps restarting, log mentions memory / "Out of memory" | The heavy engine is running | Check `WHATSAPP_DEFAULT_ENGINE` = `GOWS` on the WAHA service (then reconnect WhatsApp). If it still runs out, switch the WAHA service to the **Standard** instance type |
| Card: **"The WhatsApp server isn't set up yet"** | `WAHA_BASE_URL` missing on the backend | Step 3, then **Save, rebuild, and deploy** |
| Card: **"WhatsApp server offline"** / "Can't reach WAHA at ..." | WAHA service down, or wrong address | WAHA service must show **Live**; `WAHA_BASE_URL` must be its exact https address, no `/` at the end |
| "WAHA rejected the API key" | The two `WAHA_API_KEY` values differ | Copy the same key into both services, save both |
| QR window stays on "Preparing QR code..." | WAHA still starting | Wait 30 seconds; check the WAHA service **Logs**; close the window and click Connect again |
| Card says "Connected by another admin" | Single-session mode: another admin has WhatsApp connected | Ask them to click **Disconnect** first, or set `WAHA_MULTI_SESSION=true` on the backend so each admin has their own |
| Scanned, but the card never shows Connected | Phone offline, or the code expired | Make sure the phone has internet; close and click Connect again |
| Messages never appear in the Inbox | Incoming messages aren't reaching the backend | Backend **Logs**: look for `[webhook] whatsapp (waha) rejected`. WAHA keeps the secret the session was connected with, even if you change it later. Open **Toolbox → Connections**: the backend notices and re-registers the webhook with the current secret (log: `webhook for default repaired`). The `signature check` log line shows `"source"` and `"match"` for each delivery |
| Inbox empty and logs say `relation "whatsapp_chat_messages" does not exist` | Migration not run | Step 2 |
| First reply after a quiet period takes ~1 minute | Backend was asleep (free plan) | Normal. Upgrade the backend's instance type to remove it |
| Message arrives but no auto-reply | Safety check sent it for approval, or it's rate-limited, or the contact said STOP | **Work → Tasks** to approve; backend logs say `rate limit` or `opted out` |
| Outreach "Queued" but nothing sent | Daily limit reached, contact said STOP, backend asleep, or WhatsApp disconnected | Backend logs say which (`hit the daily limit`, `skipped ...`); open the site to wake the backend |
| "hasn't messaged your WhatsApp first" | Consent protection | Only message people who contacted you (or ask them to send START) |
| Logged out after a WAHA restart | No disk, or wrong mount path | WAHA service → **Disks**: mount path must be exactly `/app/.sessions` |
| My number got banned or restricted | WhatsApp flagged it | Keep `DAILY_WA_LIMIT` low and only message people who contacted you; for business volume use the official API (`WHATSAPP_PROVIDER=meta`) |

Switching provider later (for example to Meta's official WhatsApp Cloud API for
a paying client) is a settings change: set `WHATSAPP_PROVIDER=meta` with the
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` and
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` variables. The Inbox, STOP handling and agents
work the same.
