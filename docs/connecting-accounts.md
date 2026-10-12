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
