# WhatsApp (WAHA) setup guide

This guide walks you through every manual step to get WhatsApp working in
CodeCraft, from nothing to "a customer messages me and Ian answers". It's
written for Windows and assumes you've never used Docker or a server before.

**What you're setting up.** WAHA ("WhatsApp HTTP API") is a small program that
runs WhatsApp Web for you, the same thing you'd get by opening
web.whatsapp.com, but controllable by CodeCraft. You link your phone to it once
by scanning a QR code. Docker is the tool that runs WAHA without installing it
by hand.

- **Phase 1 (Part A):** everything on your laptop. Good for testing.
- **Phase 2 (Part B):** WAHA on a free Oracle Cloud server, so it keeps running
  when your laptop is off, and the live site on Render uses it.

> **Read this first: account safety.** WAHA uses an ordinary WhatsApp account
> through WhatsApp Web. That is not WhatsApp's official Business API, and
> WhatsApp may ban numbers that message lots of strangers or send in bulk.
> Replying to people who message you is low-risk. For outreach, use a number
> you can afford to lose, keep `DAILY_WA_LIMIT` low (start with 20), and message
> people who expect to hear from you. CodeCraft already spaces messages 30-90
> seconds apart and skips anyone who replies "stop", but that doesn't make cold
> messaging safe.

---

## What you'll need

- Your Windows laptop (Windows 10 or 11), with this project already running
  (`npm run dev` works).
- A phone with WhatsApp, for the number you want CodeCraft to use.
- A second phone, or a friend, to send test messages.
- About 1 hour for Part A and 1-2 hours for Part B.

Two secrets you'll create in step 3 and use in several places. Keep them in a
password manager or a private note:

| Secret | Used for |
|---|---|
| **API key** | Lets CodeCraft talk to WAHA (sent as `X-Api-Key`) |
| **Webhook secret** | Lets CodeCraft check that incoming messages really come from your WAHA |

---

# Part A: test everything on your laptop

## Step 1. Install Docker Desktop

1. Open https://www.docker.com/products/docker-desktop/ and click
   **Download for Windows - AMD64**. (If your laptop has an ARM chip, pick
   ARM64. Most Windows laptops are AMD64.)
2. Run the downloaded `Docker Desktop Installer.exe`. Leave **Use WSL 2 instead
   of Hyper-V** ticked and click **OK**, then **Close and restart** when asked.
3. After the restart, open **Docker Desktop** from the Start menu. Accept the
   terms. You can skip signing in.
4. If it says WSL needs updating: open **PowerShell as administrator** (right-click
   Start → *Terminal (Admin)*) and run:
   ```powershell
   wsl --update
   ```
   Then restart Docker Desktop. (Official help:
   https://docs.docker.com/desktop/setup/install/windows-install/)

**Check it worked:** open a normal PowerShell window and run:
```powershell
docker --version
docker run hello-world
```
You should see a version number, then a message starting with
`Hello from Docker!`. Docker Desktop must be open (whale icon in the taskbar)
whenever you use WAHA locally.

## Step 2. Run WAHA

1. Pick an API key: any long random text. To generate one, run this in
   PowerShell and copy the result:
   ```powershell
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
   ```
2. Start WAHA. Replace `YOUR_API_KEY` with the key from 1. This is one line:
   ```powershell
   docker run -d --name waha --restart unless-stopped -p 3000:3000 -v waha_sessions:/app/.sessions -e WAHA_API_KEY=YOUR_API_KEY devlikeapro/waha
   ```
   What the parts mean:
   - `-d` runs it in the background; `--name waha` gives it a name.
   - `--restart unless-stopped` starts it again when Docker restarts.
   - `-p 3000:3000` makes it reachable at http://localhost:3000.
   - `-v waha_sessions:/app/.sessions` keeps your WhatsApp login when WAHA restarts, so you don't rescan.
   - `-e WAHA_API_KEY=...` sets the API key.

   The first run downloads WAHA (about 1-2 GB), which takes a few minutes.

   The quick version from the README, `docker run -it -p 3000:3000 devlikeapro/waha`,
   also works, but it has no API key, and your login is lost when it stops. Use
   the line above.

**Check it worked:**
```powershell
curl.exe -H "X-Api-Key: YOUR_API_KEY" http://localhost:3000/api/sessions
```
You should see `[]` (no sessions yet). You can also open http://localhost:3000/dashboard
in your browser to see WAHA's own dashboard. (WAHA docs:
https://waha.devlike.pro/docs/overview/quick-start/)

Useful commands later:
```powershell
docker logs -f waha      # watch WAHA's log (Ctrl+C to stop watching)
docker restart waha      # restart it
docker stop waha         # stop it
docker start waha        # start it again
```

## Step 3. Create the webhook secret

Generate a second random string the same way as in step 2:
```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```
This is your **webhook secret**. WAHA signs every message it sends to CodeCraft
with it, and CodeCraft rejects anything that isn't signed. You don't give it to
the WAHA container: CodeCraft passes it to WAHA when you click Connect.

## Step 4. Create the database tables in Supabase

1. Open https://supabase.com/dashboard, sign in, and click your CodeCraft project.
2. In the left menu click **SQL Editor**, then **New query**.
3. In VS Code, open `backend/database/migrations/0005_whatsapp_waha.sql`, select
   everything (Ctrl+A), copy (Ctrl+C), and paste it into the Supabase editor.
4. Click **Run** (bottom right). You should see **Success. No rows returned**.

**Check it worked:** in the same editor, replace the text with this and click **Run**:
```sql
select table_name from information_schema.tables
 where table_name in ('whatsapp_sessions','whatsapp_chat_messages','whatsapp_outbox','whatsapp_optouts');
```
You should see 4 rows. Running the migration twice is harmless.

## Step 5. Set the backend's environment variables (local)

Open `backend/.env` in VS Code and add (or change) these lines. Replace the two
`YOUR_...` values with your secrets from steps 2 and 3:

```env
WHATSAPP_PROVIDER=waha
WAHA_BASE_URL=http://localhost:3000
WAHA_API_KEY=YOUR_API_KEY
WAHA_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
WAHA_WEBHOOK_BASE_URL=http://host.docker.internal:4000
WHATSAPP_DEFAULT_COUNTRY_CODE=233
DAILY_WA_LIMIT=20
WA_AUTO_REPLY=true
```

Why `host.docker.internal`: WAHA runs inside Docker, where "localhost" means
WAHA itself. `host.docker.internal` is Docker Desktop's name for *your laptop*,
so WAHA can deliver incoming messages to the backend on port 4000.

Save the file (Ctrl+S). The frontend needs no new settings.

Then restart the app: in the terminal running it press **Ctrl+C**, then run
`npm run dev` again.

**Check it worked:** the backend's startup lines should include:
```
[whatsapp] provider waha; outreach queue started (daily limit 20/session)
```

## Step 6. Link your WhatsApp (scan the QR code)

1. Open http://localhost:5173 and sign in.
2. Go to **Toolbox → Connections**. At the top is **WhatsApp (your phone)**.
   Click **Connect WhatsApp**.
3. A window with a QR code opens. On your phone:
   - **Android:** open WhatsApp → tap **⋮** (top right) → **Linked devices** →
     **Link a device**.
   - **iPhone:** open WhatsApp → **Settings** → **Linked Devices** →
     **Link a Device**.
   Point the camera at the QR code.
4. After a few seconds the window closes by itself, and the card shows
   **Connected** and your number.

**Check it worked:** on your phone, under Linked devices, you'll see a new
device. In PowerShell, `curl.exe -H "X-Api-Key: YOUR_API_KEY" http://localhost:3000/api/sessions`
now lists a session named `admin_...` with `"status":"WORKING"`.

Each admin who signs in to CodeCraft does this for their own WhatsApp. They
each get their own session and only see their own chats.

## Step 7. Test receiving and auto-replies

1. From your **second phone**, send a WhatsApp message to the linked number,
   e.g. *"Hi, what are your opening hours?"*
2. In CodeCraft open **Work → Inbox**. Within about 10 seconds the conversation
   appears with the message.
3. A few seconds later your second phone shows **typing...** and then the
   agent's reply. The Inbox shows it with the label *auto-reply*.
   - If the reply doesn't come, check **Work → Tasks**. Replies the safety
     check isn't sure about (refunds, complaints, legal, anything not grounded
     in your business profile) wait there for your approval instead.
     Approve one to send it.
   - Auto-replies need your business info filled in (Settings → General);
     without it, every reply waits for approval.

## Step 8. Test sending, outreach and "stop"

1. **Manual reply:** in **Work → Inbox**, open the conversation, type a reply,
   click **Send**. It arrives on the second phone straight away.
2. **New message (outreach):** in the Inbox click **+ New message**, enter the
   second phone's number (`024...` or `+233...` both work) and a message, click
   **Queue**. It goes out within about 30-90 seconds, through the outreach
   queue.
3. **Stop:** from the second phone reply `STOP`. That number is now skipped by
   all future outreach from your WhatsApp (replies to their own messages still
   work).

**Check it worked:** the backend log shows lines like
`[whatsapp] sent (waha/admin_... -> 233..., outreach)` and
`[whatsapp] 233... opted out of outreach`.

## Step 9 (optional). Let the live site use your laptop's WAHA with ngrok

Only if you want the live site on Render to use the WAHA on your laptop before
setting up Part B. ngrok gives your local WAHA a temporary public address.

1. Sign up (free): https://dashboard.ngrok.com/signup
2. Install it. In PowerShell:
   ```powershell
   winget install ngrok.ngrok
   ```
   (or download from https://ngrok.com/download). Close and reopen PowerShell.
3. Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken and run:
   ```powershell
   ngrok config add-authtoken YOUR_NGROK_TOKEN
   ```
4. Start the tunnel to WAHA:
   ```powershell
   ngrok http 3000
   ```
   Copy the **Forwarding** address that starts with `https://` (e.g.
   `https://abcd-1234.ngrok-free.app`). Leave this window open.
5. On Render, set `WAHA_BASE_URL` to that address. The other WAHA variables
   are as in step 12. Then open the live site, go to Toolbox → Connections, and
   wait for the card to load: CodeCraft automatically points WAHA's webhook at
   Render.

The free ngrok address changes every time you restart ngrok, and it only works
while your laptop and ngrok are running. Part B fixes both.

---

# Part B: run WAHA on a free Oracle Cloud server

## Step 10. Create an Oracle Cloud account and a free server

1. Sign up for the free tier: https://www.oracle.com/cloud/free/ → **Start for
   free**. You need a card for identity verification; Always Free resources
   are not charged. Choose a **home region** close to you (it can't be
   changed later).
2. When the console opens, click the menu **☰** → **Compute** → **Instances** →
   **Create instance**.
3. Fill in:
   - **Name:** `waha`
   - **Image and shape → Edit:**
     - Image: **Canonical Ubuntu 24.04** (or 22.04).
     - Shape: **Ampere** → **VM.Standard.A1.Flex**, 1 OCPU and 6 GB memory
       (labelled *Always Free-eligible*). If Ampere is "out of capacity", try
       again later or another availability domain. The AMD
       *VM.Standard.E2.1.Micro* also works but has only 1 GB of memory (see
       Troubleshooting).
   - **Networking:** keep the defaults (new virtual cloud network, public
     subnet, **Assign a public IPv4 address** on).
   - **Add SSH keys:** choose **Generate a key pair for me** and click **Save
     private key**. Move the downloaded `.key` file to `C:\Users\<you>\.ssh\waha.key`.
4. Click **Create**. When the instance shows **Running**, copy its **Public IP
   address** (e.g. `129.146.10.20`). You'll use it below.

## Step 11. Connect to the server and install Docker

1. Open PowerShell and connect. Replace the IP with yours (type `yes` the first time):
   ```powershell
   ssh -i $HOME\.ssh\waha.key ubuntu@129.146.10.20
   ```
   If Windows complains the key's permissions are too open, run this once and try again:
   ```powershell
   icacls $HOME\.ssh\waha.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
   ```
   You're now typing commands on the server. The prompt looks like `ubuntu@waha:~$`.
2. Install Docker (official script, https://docs.docker.com/engine/install/ubuntu/):
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker ubuntu
   exit
   ```
   Then connect again with the same `ssh` command (so the group change applies).

**Check it worked:** `docker run hello-world` prints `Hello from Docker!`.

## Step 12. Run WAHA on the server

On an **Ampere (ARM)** server, first get the ARM image (from WAHA's quick start):
```bash
docker pull devlikeapro/waha:arm
docker tag devlikeapro/waha:arm devlikeapro/waha
```
(On the AMD micro server, skip this.)

Then start WAHA. Use the **same API key** as in `backend/.env`, and choose a
dashboard password. This is one command:
```bash
docker run -d --name waha --restart unless-stopped -p 127.0.0.1:3000:3000 -v waha_sessions:/app/.sessions -e WAHA_API_KEY=YOUR_API_KEY -e WAHA_DASHBOARD_USERNAME=admin -e WAHA_DASHBOARD_PASSWORD=CHOOSE_A_PASSWORD -e WHATSAPP_SWAGGER_USERNAME=admin -e WHATSAPP_SWAGGER_PASSWORD=CHOOSE_A_PASSWORD devlikeapro/waha
```
- `127.0.0.1:3000:3000`: WAHA is only reachable from inside the server. The
  internet reaches it through HTTPS (step 13), never directly.
- `-v waha_sessions:/app/.sessions`: your WhatsApp login is stored in a Docker
  volume, so it survives restarts and updates.

**Check it worked:**
```bash
curl -H "X-Api-Key: YOUR_API_KEY" http://127.0.0.1:3000/api/sessions
```
prints `[]`.

## Step 13. Open the firewall and add HTTPS

CodeCraft on Render will reach WAHA over HTTPS on port 443. Port 80 is only
used to get and renew the free HTTPS certificate. No other port is opened.

**13a. Oracle's firewall (Security List).**
1. In the Oracle console: **☰ → Compute → Instances → waha**. Under **Primary
   VNIC** click the **Subnet** name, then the **Security List** (e.g. *Default
   Security List*).
2. Click **Add Ingress Rules** and add one rule:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: TCP
   - Destination Port Range: `80,443`
3. Click **Add Ingress Rules**. (Leave the existing SSH port 22 rule.) Docs:
   https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm

**13b. The server's own firewall.** Oracle's Ubuntu images block ports by
default, so open the same two ports on the server:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

**13c. HTTPS with Caddy (free certificate, renews itself).**
You need a hostname for the certificate. If you don't have a domain, use
**sslip.io**, a free service where a name containing your IP points to your IP.
For IP `129.146.10.20` the name is `129-146-10-20.sslip.io` (dots become dashes).

Install Caddy (official steps: https://caddyserver.com/docs/install#debian-ubuntu-raspbian):
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```
Tell Caddy to serve WAHA over HTTPS (replace the hostname with yours):
```bash
echo '129-146-10-20.sslip.io {
    reverse_proxy 127.0.0.1:3000
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

**Check it worked:** on your laptop, in PowerShell:
```powershell
curl.exe -H "X-Api-Key: YOUR_API_KEY" https://129-146-10-20.sslip.io/api/sessions
```
prints `[]`. Without the key it should fail with 401 (the API key is required).
If it fails, give Caddy a minute to get the certificate, then check
`sudo journalctl -u caddy --no-pager | tail -20`.

## Step 14. Point Render at the server

1. Open https://dashboard.render.com → your backend service → **Environment**.
   (Docs: https://render.com/docs/configure-environment-variables)
2. Add or edit these variables:

   | Key | Value |
   |---|---|
   | `WHATSAPP_PROVIDER` | `waha` |
   | `WAHA_BASE_URL` | `https://129-146-10-20.sslip.io` (your hostname) |
   | `WAHA_API_KEY` | your API key |
   | `WAHA_WEBHOOK_SECRET` | your webhook secret |
   | `WHATSAPP_DEFAULT_COUNTRY_CODE` | `233` |
   | `DAILY_WA_LIMIT` | `20` (raise slowly later) |
   | `WA_AUTO_REPLY` | `true` |

   You don't need `WAHA_WEBHOOK_BASE_URL` on Render: CodeCraft uses Render's
   own address (`RENDER_EXTERNAL_URL`) automatically.
3. Click **Save, rebuild, and deploy**.
4. **Vercel:** nothing to change. The frontend talks only to your backend.
   (Env var docs, for reference: https://vercel.com/docs/environment-variables)
5. Make sure migration `0005_whatsapp_waha.sql` has run (step 4). It's the
   same Supabase project for local and live.

## Step 15. Link WhatsApp on the live site and test

1. Open your live site → **Toolbox → Connections** → **Connect WhatsApp** and
   scan the QR code as in step 6. The server's WAHA starts empty, so even if
   you linked locally before, the card shows **Not connected** (or
   **Reconnect WhatsApp**): just connect again. Then unlink the old laptop
   device on your phone (Linked devices → tap it → Log out) and stop the local
   WAHA (`docker stop waha` on your laptop), so only one copy answers.
2. Repeat the tests from steps 7 and 8 on the live site.
3. Check the server keeps your login after a restart:
   ```bash
   docker restart waha
   ```
   After about a minute the card still says **Connected**, with no new scan needed.

## Step 16. Keeping it running

- **Updates** (every month or so), on the server:
  ```bash
  docker pull devlikeapro/waha   # on ARM: pull devlikeapro/waha:arm and tag it, as in step 12
  docker stop waha && docker rm waha
  ```
  Then run the `docker run` command from step 12 again. Your login is kept in
  the `waha_sessions` volume.
- **If WhatsApp gets disconnected** (you logged out from the phone, or the
  phone was offline for about 2 weeks), a red **"WhatsApp was disconnected"**
  banner appears in CodeCraft. Click **Reconnect** and scan again.
- **WAHA's own dashboard** (sessions, logs): open an SSH tunnel from your laptop,
  `ssh -i $HOME\.ssh\waha.key -L 3000:127.0.0.1:3000 ubuntu@129.146.10.20`, then
  browse to http://localhost:3000/dashboard and sign in with the dashboard user.

---

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| `docker: command not found` / "Docker Desktop is not running" | Docker Desktop isn't open | Start Docker Desktop and wait for the whale icon to stop animating |
| Connections card: **"The WhatsApp server isn't set up yet"** | `WAHA_BASE_URL` not set on this backend | Set it (step 5 locally, step 14 on Render) and restart |
| Card: **"WhatsApp server offline"** / "Can't reach WAHA at ..." | WAHA isn't running, or the address is wrong | Locally: `docker ps` should list `waha`; start it with `docker start waha`. Server: `curl` test in step 13c |
| "WAHA rejected the API key" | `WAHA_API_KEY` in CodeCraft differs from the container's | Make them identical. To change the container's key, remove and re-run it (step 2/12) |
| QR window says "Preparing QR code..." forever | Session still starting, or WAHA restarting | Wait 30 seconds; check `docker logs waha` for errors; close the window and click Connect again |
| Scanned, but the card never shows Connected | The phone has no internet, or the QR expired | Make sure the phone is online; close and click Connect again (the QR refreshes every ~20s) |
| Messages to my number never show in the Inbox | WAHA can't reach the backend's webhook, or the secret differs | Locally `WAHA_WEBHOOK_BASE_URL=http://host.docker.internal:4000`; check `WAHA_WEBHOOK_SECRET` is set; look in the backend log for `[webhook] whatsapp (waha) rejected` (secret mismatch) |
| Backend log: `[webhook] whatsapp (waha) rejected: bad or missing X-Webhook-Hmac` | The session was created with a different webhook secret | Click **Disconnect**, then **Connect** again (this re-registers the webhook with the current secret) |
| Inbox empty and log shows `relation "whatsapp_chat_messages" does not exist` | Migration not run | Run step 4 |
| Message arrives but no auto-reply | The safety check sent it for approval, or `WA_AUTO_REPLY=false` | Look in **Work → Tasks** and approve; fill in Settings → General (business info) |
| Outreach "Queued" but nothing sent | Daily limit reached, the contact replied stop, or WhatsApp disconnected | Backend log says which: `hit the daily limit`, `skipped ... (opted out)`, or the reconnect banner shows |
| Red "WhatsApp was disconnected" banner | WhatsApp logged the device out | Toolbox → Connections → **Reconnect WhatsApp** and scan |
| `ssh: ... Permission denied (publickey)` | Wrong key file, or user | The user is `ubuntu`; use the `.key` file Oracle gave you; fix permissions with the `icacls` line in step 11 |
| `curl` to the server times out | Port closed | Re-check both firewalls (step 13a and 13b) |
| Caddy shows certificate errors | Port 80 blocked, or the hostname doesn't match the IP | Open port 80 (step 13); the sslip.io name must contain your exact IP |
| WAHA keeps restarting on the 1 GB AMD server | Not enough memory for the default browser-based engine | Re-run WAHA with the lighter engine: add `-e WHATSAPP_DEFAULT_ENGINE=GOWS` to the step 12 command (then reconnect), or use the Ampere shape |
| My number got banned or restricted | WhatsApp flagged it for messaging many strangers | See the warning at the top. Lower `DAILY_WA_LIMIT`, message only people who know you, and use the official Business API (Twilio) for bulk |

Going back to Twilio at any time: set `WHATSAPP_PROVIDER=twilio` (with the
`TWILIO_*` variables) and restart. The Inbox keeps the history from both.
