# Deployment

How the three services fit together, and how to deploy each one.

---

## 1. The picture

```
┌─────────────┐  HTTPS   ┌─────────────┐  HTTPS   ┌──────────────┐
│   Browser   │ ───────► │   Vercel    │ ───────► │    Render    │
│   (user)    │          │ (frontend)  │   API    │   (backend)  │
└─────────────┘          └─────────────┘ requests └──────┬───────┘
                                                         │
                                                         │ Postgres
                                                         ▼
                                                  ┌──────────────┐
                                                  │   Supabase   │
                                                  │  (database)  │
                                                  └──────────────┘
```

- **Vercel** serves the static React/Vite build. Auto-deploys every push to
  `main`. No server-side logic lives here — it's purely HTML/JS/CSS.
- **Render** runs the Node/Express backend as a Web Service. All agent code,
  the scheduler, the orchestrator, and the Supabase service-key client live
  here. **This is the only place the Supabase service_role key may live.**
- **Supabase** is the Postgres database and the auth system. The frontend
  talks to Supabase directly for login/signup using the public anon key; the
  backend uses the service key to bypass RLS (because the backend already
  enforces its own workspace guard).

---

## 2. Deploying the backend on Render

Render connects to your GitHub repository and watches the `backend/` folder.

**Build command:** `npm install --prefix backend`
**Start command:** `npm start --prefix backend`
**Root directory:** `backend` (or leave blank and use the prefixes above)

### Manual deploy

Even with auto-deploy on, you can force a redeploy from the Render dashboard:

1. Dashboard → the backend service → **Manual Deploy** → **Deploy latest commit**.
2. Watch the **Events** tab for "Deploy succeeded".
3. The latest Event shows the commit SHA. Compare it against
   `git rev-parse --short HEAD` locally to confirm the right commit is live.
4. The **Logs** tab shows startup output:
   `[scheduler] started - checking workflows every minute` means the server is up.

### Reading logs

- Startup: look for `Server listening on port <PORT>` and the scheduler line.
- Request-level: `[route] POST /api/orchestrator/goal` entries confirm the
  frontend is reaching the backend.
- Errors: unhandled rejections print to stderr; Supabase transport warnings are
  collapsed to a single line by the global `uncaughtException` hook.

---

## 3. Deploying the frontend on Vercel

Vercel also connects to GitHub and auto-deploys on push.

**Framework preset:** Vite
**Root directory:** `frontend`
**Build command:** `npm run build`
**Output directory:** `dist`

### SPA refresh fix

`frontend/vercel.json` rewrites every unknown path to `index.html` so a hard
refresh on `/tasks` or `/workflows` returns the app, not a 404. If a Vercel
deploy breaks this, re-check that file is present in the deploy output.

### `VITE_*` env vars

These are baked into the JavaScript bundle at build time, not read at runtime.
Set them in Vercel → Project settings → Environment Variables. Changing one
requires a redeploy.

---

## 4. Supabase

Nothing to "deploy" — Supabase is the database. See [setup-guide.md](setup-guide.md)
for migrations. Free-tier Supabase projects pause after a week of inactivity;
visit the dashboard to wake them up before you expect requests.

---

## 5. Render free plan — the sleeping problem

On the Render free plan, a web service **sleeps after 15 minutes of inactivity**
and takes ~30 seconds to wake up on the next request.

What this means for CodeCraft:

- **Scheduler**: the scheduler ticks every 60 seconds while the backend is
  running. While the service is asleep, **ticks don't happen** — a workflow
  scheduled to run at a specific time only runs if the server was awake then.
- A hourly interval workflow may skip multiple runs during off-hours.
- A daily 09:00 workflow fires sometime after the first visitor hits the site
  after 09:00 (whenever the backend wakes up).

For reliable schedules, upgrade to a paid tier that doesn't sleep, or ping the
backend from an external cron (e.g. UptimeRobot every 10 minutes).

---

## 6. Keeping `.env` and Render Environment in sync

Local `.env` is for development only. Production reads from the Render
Environment tab. **A change in `.env` doesn't reach production.**

Workflow:

1. Make the local change in `backend/.env`.
2. Verify it works (`npm run dev`).
3. Copy the same name+value into Render → Environment → **Add Environment
   Variable** (do not paste through screen-share tools; type directly in the
   secret field).
4. Save → Render automatically restarts the service with the new env.
5. Confirm the new value is in effect via the appropriate `/status` endpoint
   (e.g. `GET /api/composio/gmail/status` after a Gmail reconnect).

The same applies to Vercel for `VITE_*` vars.

---

## 7. Post-deploy checklist

- `GET https://<backend>/health` returns 200.
- Open the frontend, log in, land on the Dashboard with no console errors.
- `GET /api/me` shows your email, role=`admin`, workspace fields populated.
- Settings → **Workspace health** panel is empty (or only shows the expected
  scheduler-tick entries — see [workspaces.md](workspaces.md)).
- A test chat message to Ian returns a reply.
- A test Workflow (e.g. "every 5 minutes, give me the time of day") runs and
  shows up under the Workflows page.

---

## 8. Rollback

See [runbooks.md § Rolling back a bad deploy](runbooks.md#rolling-back-a-bad-deploy).
