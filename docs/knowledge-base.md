# Knowledge base and agent tuning

Everything that controls how the WhatsApp agent replies is on one page:
**Settings → General**. Changes apply on the agent's **next reply** - no code
changes and no redeploy.

| Tab | What it's for |
|---|---|
| **Profile** | Business name, contact details, what you offer, email signature. The agent uses the business details; your personal name and email signature stay out of WhatsApp. |
| **Agent instructions** | The agent's name, how it talks (tone, reply length), rules, what it must never do, example replies, and the "team will follow up" message. Every save is a new version; roll back any time. |
| **Q&A** | Questions and answers the agent treats as approved facts. Each has an on/off switch. |
| **Documents** | Menus, price lists, policies (PDF, Word, text, CSV, Excel - 10 MB max). The text is read automatically. |
| **Test chat** | Talk to the agent as a customer. Nothing is sent to anyone. Each reply shows whether it would be sent or held (and why) and which Q&A/documents it used. |

## How a reply is put together

For every customer message the agent gets:

1. **Agent instructions** (newest version) and **example replies**.
2. **Business profile** details (name, offers, location, phone, website, email).
3. **Q&A** - all switched-on entries if you have up to 25, otherwise the 8 that
   best match the message.
4. **Documents** - all the text if it's short (about 6,000 characters in
   total), otherwise the 5 sections that best match the message. Only files
   showing *Ready* are used.
5. The conversation so far and the time of day (for "Good morning…").

Matching uses the database's built-in text search (free). It copes with
different word endings ("deliver" / "delivery") and short follow-ups
("and on Sunday?").

## It never makes things up

- The agent is told to answer only from the knowledge above. If the answer
  isn't there it says a team member will follow up, and the message **waits
  for your approval** (you get a Telegram/WhatsApp alert; the suggested answer
  is on the Tasks page).
- As a safety net, any reply containing a **phone number, email, link or clock
  time** that isn't in your knowledge is held, even if the AI forgot to hold it.
- These always wait for you: prices and quotes, deals, deadlines and delivery
  times, complaints, and anything the agent isn't sure about.

## Fixing a wrong answer

Click **Correct this answer** under any agent reply - in the Test chat or in
**Work → Inbox**. Write the right answer and save: it becomes a Q&A entry
(marked "from a correction") and is used from the next reply. Correcting the
same reply again updates that entry. Saving a correction never messages the
customer - reply to them yourself if needed.

## Tips

- Facts (prices, hours, delivery areas, policies) work best as **Q&A** or
  **documents**; keep the **instructions** for tone and rules.
- Write Q&A questions the general way customers ask ("Do you deliver?"), not
  one specific message.
- After a change, try it in the **Test chat** first.
- If a document shows *Failed*, the reason is shown next to it. Scanned PDFs
  (photos of paper) have no text - upload a Word/text version or add Q&A.
- **View text** on a document shows exactly what the agent reads.
- `{{agent_name}}` and `{{business_name}}` in the instructions are filled in
  automatically. A `## Email & outreach tone` section is also used by the email
  and outreach agents.

## Setup (one time)

Run the database migration once:

1. Back up. Free Supabase plan: on your computer, in the project folder, run
   `node backend/scripts/backup-db.js --label=pre-0006` (read-only; saves every
   table as JSON under `backups/`, which git ignores). Paid plan: Supabase →
   Database → Backups.
2. Supabase → **SQL Editor** → New query → paste
   `backend/database/migrations/0006_knowledge_base.sql` → **Run**.
   You should see "Success. No rows returned". Safe to run more than once.

It creates the knowledge-base tables, a private file bucket
(`knowledge-docs`), and copies the WhatsApp agent's previous rules into
version 1 for every workspace with WhatsApp connected. Until it's run, the agent
keeps using `backend/config/whatsapp-voice.md`.

Optional settings (`backend/.env`, or Render → Environment):

| Variable | Default | What it does |
|---|---|---|
| `WA_TIMEZONE` | `Africa/Accra` | Time zone for "Good morning / afternoon / evening". |
| `WA_PLACE` | `Ghana` | Where the business is, as told to the agent. |

## Products, photos and payments

**Settings → General → Products** is the catalogue Ian uses (run migration
`0007_products.sql` once, same way as 0006):

- **Import your website** - Shopify and WooCommerce shops (prices, stock, photos),
  pages with schema.org product data, or any normal site (the AI reads the page and
  lists your products/services; services are "always available"). **Sync now**, and an
  optional **daily re-sync**. Items no longer on the site are switched off, not deleted.
- **Upload CSV/Excel** with a Name column (optional Price, Stock/Qty, Category,
  Description, Image, Link, Other names). Uploading again updates the same products.
- **Add / edit by hand**, with an on/off switch per product.
- **Local words** - Pidgin/Twi/slang customers use ("ahwenepa" → kente cloth). Common
  Ghanaian ones are built in; misspellings ("jolof", "trowser") are handled automatically.

How Ian uses it:

- Up to 30 products are all shown to him (best matches first); more are searched.
- **Stock**: website products are re-checked live (cached 10 minutes) before he talks
  about them; file/manual products use the saved stock. "Unknown" is never promised.
- **Customer photos**: he looks at the photo, matches it to your products and replies.
  If a photo can't be downloaded or read, you're alerted instead. Stickers and voice
  notes still alert you.
- **Product photos**: after a reply goes out, he can send up to 3 product photos
  (caption = name, never a price). If a photo can't be sent, the product link is sent
  with a preview.
- **Payments are never confirmed by Ian** - "I've paid", MoMo/transfer messages and
  receipt screenshots get "A team member will check and confirm your payment shortly"
  and you're alerted.
- Prices still wait for your approval (and no photos are sent while a reply waits).

## Several businesses (clients)

Everything here belongs to a **workspace** - one per business. Each workspace
has its own profile, instructions and versions, Q&A, documents and test chat,
and nothing is shared between them:

- every database read and write is filtered by the signed-in person's workspace;
- the database's row-level security (in migration 0006) only lets members of a
  workspace see its rows;
- nothing about one business is written into the code - names come from the
  Profile and the instructions;
- each WhatsApp connection belongs to a workspace, so incoming messages use
  that business's knowledge.

### Letting clients edit their own knowledge base (later)

Who may edit is decided in one place: `backend/core/workspaceAccess.js`
(the workspace's **owner** or an **editor**). Today the pages are admin-only.
To open them to a client:

1. Create the client's login and a workspace for their business (the client
   becomes its owner), or add them to an existing workspace in
   `workspace_members` with role `editor`.
2. In `backend/server.js`, change the `/api/agent-settings` and
   `/api/knowledge` lines from `requireRole('admin')` to
   `requireRole('admin', 'client')`.
3. Show the Settings page to client accounts in the frontend navigation.

Nothing else changes - every route already works on the signed-in person's own
workspace only.

Before onboarding paying clients, two things are still single-owner and worth
making per-workspace:

- **Owner alerts** (Telegram / WhatsApp) go to the numbers in the server
  settings (`OWNER_TELEGRAM_CHAT_ID`, `OWNER_WHATSAPP_NUMBER`), i.e. to you, for
  every business. Each client would want their own.
- **WhatsApp numbers**: with `WAHA_MULTI_SESSION=true` each admin connects
  their own number; clients would need the same.

## Where things are in the code

| Part | File |
|---|---|
| Database tables | `backend/database/migrations/0006_knowledge_base.sql` |
| Storage (per workspace) | `backend/core/knowledge/store.js` |
| Instructions + versions | `backend/core/knowledge/agentSettings.js`, `backend/api/agentSettingsRoutes.js` |
| Q&A, corrections | `backend/core/knowledge/qa.js` |
| Documents (reading, splitting) | `backend/core/knowledge/documents.js` |
| Picking knowledge for a message | `backend/core/knowledge/retrieval.js` |
| Test chat | `backend/core/knowledge/testChat.js` |
| API routes | `backend/api/knowledgeRoutes.js` |
| Who may edit | `backend/core/workspaceAccess.js` |
| The WhatsApp agent | `backend/agents/whatsapp/WhatsAppAgent.js`, `backend/core/whatsapp/replyPolicy.js` |
| Settings page | `frontend/src/pages/Settings.jsx`, `frontend/src/components/settings/` |
| Tests | `backend/tests/agent-settings`, `knowledge-*` |
