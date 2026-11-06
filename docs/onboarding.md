# Onboarding: welcome, setup checklist and tour

Onboarding is how a new workspace gets set up. It has four parts: a welcome screen, a setup checklist, a guided tour, and helpful empty pages.

## What users see

- **Welcome screen.** It shows **once per workspace**, the first time an admin opens the app. It has two buttons:
  - **Start setup** starts the tour.
  - **Maybe later** opens the checklist instead. The tour then stays available from Help.
- **Setup checklist**, with a progress bar showing "3 of 6 done". It appears in the sidebar card, on the Dashboard, and under Help → Setup checklist.
  1. Business Profile: done when a business name is saved.
  2. Agent tone and instructions: done once instructions have been saved at least once.
  3. Knowledge base: done when there is at least 1 Q&A or 1 document.
  4. Products: done when there is at least 1 product.
  5. Connect WhatsApp: done when a number is linked. This works with a QR code or a pairing code.
  6. Test chat: done when at least 1 message has been sent in the Test chat.
- **How steps behave:**
  - Every step ticks itself off from real data. Nobody ticks anything by hand.
  - Any step can be skipped, or put back on the list later.
  - **Hide this list** appears once every step is done or skipped.
- **Guided tour.** It shows **once per person**, on their first login. It has seven stops: the menu, Business Profile, Products, Leads, Test chat, Approvals, and the Help button.
  - Each stop has Next, Back and Skip buttons.
  - The tour can be replayed any time from **Help (?) → Take the tour** in the top bar.
- **Empty pages.** Leads, Inbox, Tasks, Q&A, Documents and Products each show a short tip and a button to get started.

## WhatsApp: one number for now

On single-session WAHA (the Core tier), only one person can link WhatsApp:
- the app owner, set by `APP_OWNER_EMAIL`;
- or whoever already holds the session.

Everyone else sees **"Not available yet"** on the Connections card. In their checklist, the WhatsApp step says it isn't available yet and is left out of their total, so they see 5 steps instead of 6.

If `APP_OWNER_EMAIL` isn't set, the old rule applies: whoever connects first holds the session. With `WAHA_MULTI_SESSION=true` (WAHA Plus), everyone can connect their own number.

## Setup

1. Back up the database:
   ```
   cd backend
   node scripts/backup-db.js --label=before-onboarding
   ```
2. In Supabase, open **SQL Editor** and paste `backend/database/migrations/0009_onboarding.sql`. Click **Run**.
3. Deploy.

Until the migration is run, the checklist still works, but nothing pops up, because the app has nowhere to remember what was seen.

## Code

| Area | Files |
|---|---|
| Logic | `backend/core/onboarding/index.js` (works out which steps are done) |
| Storage | `backend/core/onboarding/store.js` |
| API | `backend/api/onboardingRoutes.js` (`/api/onboarding`) |
| Frontend | `frontend/src/components/onboarding/`: `OnboardingHost` (welcome screen and checklist panel), `SetupChecklist`, `SidebarSetupCard`, `HelpMenu`, `tour.js` (driver.js) |
| Empty pages | `frontend/src/components/EmptyState.jsx` |
| Pairing code | `POST /api/whatsapp/session/pairing-code` and `WahaProvider.requestPairingCode` |
| Tests | `backend/tests/onboarding.test.js` |
