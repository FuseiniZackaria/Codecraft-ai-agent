# Connecting Accounts

Each workspace connects its own accounts. Credentials are encrypted and never shared between workspaces.

---

## Telegram

1. Open Telegram and search for **@BotFather**.
2. Send `/newbot` and follow the prompts to name your bot.
3. BotFather will give you a **bot token** (looks like `123456:ABC-DEF1234...`).
4. Go to **Connections** in CodeCraft, click **Connect** on the Telegram card.
5. Paste the token and click **Save & Verify**.
6. CodeCraft verifies the token, registers the webhook automatically, and shows your bot's @username.
7. Your bot is live — incoming messages route to your workspace.

**Test:** Click **Test** and enter a Telegram chat ID to receive a test message.

**Disconnect:** Click **Disconnect** to remove the webhook and delete the stored token.

---

## WhatsApp

Two options are available:

### Option A — Meta Cloud API (free tier available)

1. Create a Meta app at developers.facebook.com and enable the WhatsApp product.
2. In the app dashboard, find your **Phone Number ID** and generate a permanent **Access Token**.
3. Copy your **App Secret** from the app settings.
4. In CodeCraft Connections, click **Connect** on WhatsApp, choose the **Meta Cloud API** tab.
5. Paste the Phone Number ID, Access Token, and App Secret, then click **Connect**.
6. CodeCraft shows a **Webhook URL** and **Verify Token** — copy both into Meta's webhook configuration.

### Option B — Twilio

1. Sign up at twilio.com and enable the WhatsApp sandbox (or apply for a production number).
2. Find your **Account SID** and **Auth Token** in the Twilio console.
3. In CodeCraft Connections, click **Connect** on WhatsApp, choose the **Twilio** tab.
4. Paste the Account SID, Auth Token, and your WhatsApp-enabled phone number.
5. Click **Connect** — CodeCraft verifies the credentials.
6. Copy the displayed **Webhook URL** into Twilio's WhatsApp sandbox/number settings.

**Test:** Click **Test** and enter a phone number (with country code) to receive a test message.

**Disconnect:** Click **Disconnect** to remove the stored credentials.

---

## Gmail

1. In CodeCraft Connections, click **Connect** on the Gmail card.
2. A sign-in window opens (powered by Composio). Authorize your Google account.
3. Click **I completed authorization** back in CodeCraft.
4. The card shows **Connected** with your email.

**Disconnect:** Click **Disconnect** to revoke the connection.

---

## Google Calendar

Same flow as Gmail — click **Connect**, authorize via Google, confirm back in CodeCraft.

---

## GitHub

Same flow as Gmail — click **Connect**, authorize via GitHub, confirm back in CodeCraft.

---

## Google Sheets (lead storage)

When connected, **Sales Manager** saves every lead it finds as a new row: `timestamp` (UTC), `name`, `email`, `phone`, `source`, `notes`. The header row is created automatically, and a lead whose email is already in the sheet is skipped.

**One-time server setup (app owner):**

1. In [Google Cloud Console](https://console.cloud.google.com/), pick or create a project and enable the **Google Sheets API** (APIs & Services → Library). The Drive API is not needed.
2. Go to **IAM & Admin → Service Accounts → Create service account**. No roles are needed. Open it → **Keys → Add key → Create new key → JSON** and download the file. Keep it private — never commit it (it's in `.gitignore`).
3. On **Render → backend service → Environment**, add `GOOGLE_SERVICE_ACCOUNT_JSON` and paste the whole JSON file as the value. (Alternatively upload it as a **Secret File** and set `GOOGLE_SERVICE_ACCOUNT_FILE=/etc/secrets/<file name>`.) Locally, put the same variable in `backend/.env`.
4. Optional: set `LEADS_SHEET_ID` to a sheet id as the fallback sheet for **your own workspace only**.

**Each workspace:**

1. Create a Google Sheet. The sheet id is the long part of its URL: `https://docs.google.com/spreadsheets/d/<SHEET ID>/edit`.
2. Click **Share** and add the service account's address (the `client_email` in the key file, shown on the Connections page) as an **Editor**.
3. In CodeCraft go to **Connections → Google Sheets → Connect**, paste the sheet link, and click **Connect sheet**. CodeCraft checks it can open the sheet before saving it.

**Check the connection:** `cd backend && npm run check:sheets` (or `npm run check:sheets -- <sheet link>`) writes one sample row. Running it twice shows the duplicate-email skip.

A workspace without its own sheet never writes to another workspace's sheet or to `LEADS_SHEET_ID`.

---

## Security notes

- Bot tokens and API keys are encrypted with AES-256-GCM before storage. They are never returned in API responses or logged.
- Each workspace has its own webhook URL with a unique random token. Incoming messages are routed to the correct workspace by this token.
- If a workspace has not connected a provider, any attempt to send through that provider is blocked with a clear error — there is no fallback to another workspace or to environment defaults.
- The encryption key is derived from `WORKSPACE_ENCRYPTION_KEY` (if set) or `SUPABASE_SERVICE_KEY`. Set `WORKSPACE_ENCRYPTION_KEY` in production for best practice.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Telegram "Invalid token" | Re-copy the full token from @BotFather (starts with digits, colon, then letters). |
| WhatsApp messages not arriving | Check that the webhook URL and verify token are entered correctly in Meta / Twilio. |
| Composio popup doesn't open | Allow popups for your CodeCraft domain in your browser. |
| "Not connected" error on send | Go to Connections and connect the provider for your workspace first. |
