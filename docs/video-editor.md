# Content Studio video editor

Upload a video, answer three questions, download it finished, with its post
caption and hashtags. Open it at **Departments → Marketing & Content → Video editor**.

What it does for every video (Jam's workflow):

1. Asks: where it's going (Instagram, TikTok, YouTube), what viewers should do
   at the end, and captions and graphics or a clean cut.
2. Never changes the original. Finished videos are saved as new files next to it
   (`name_tiktok_9x16.mp4`, `name_youtube_16x9.mp4`, `name_test_7s.mp4`).
3. Transcribes every word with free, local Whisper (through HyperFrames).
4. Cuts retakes ("let's redo that", restarted sentences), keeps the best take,
   and cuts pauses longer than 0.5 s.
5. Splits a recording with several videos into separate files.
6. Uses the business's brand kit: two or more colours, a font, its voice, a logo
   and a B-roll kit. It asks once if none is saved.
7. Exports 9:16 for TikTok and Reels or 16:9 for YouTube at top quality: H.264
   High, CRF 16, slow preset, AAC 320 kbps. It uses the original resolution or
   higher where that keeps more detail, up to 4K.
8. Levels each stretch of voice on its own, so an AI voice and a real voice play
   at the same volume.
9. Brightens dark footage, calms grain, and says honestly when a reshoot would be
   better.
10. Says where the files are saved and reminds you to watch them before posting.
11. Makes a 7-second test clip with branded captions first, to prove the edit
    works before the long export. There's also a "Make a 7-second test clip"
    button in the brand kit.

## How it runs (free)

```
Browser ──upload──▶ Cloudflare R2 ◀──download── Browser
   │                  ▲      │
   ▼                  │      ▼ (signed links only)
Backend (Render) ◀──jobs, progress──▶ Video worker (your laptop now, Render later)
```

- **The backend** (Render, free plan) only handles small requests: jobs, progress
  and short-lived signed links. Big files never pass through it.
- **The worker** does the editing (FFmpeg, local Whisper, HyperFrames). It only
  needs `BACKEND_URL` and `VIDEO_WORKER_TOKEN`. It never holds your database,
  storage or AI keys.
- **HyperFrames** renders on the worker for free (local Chrome and FFmpeg).
  Cloud rendering, HeyGen and AWS are never used, and telemetry is off.
- **Retakes and the post caption** use your existing AI account (Claude), about
  1–5 cents per video. If the AI doesn't answer, retakes fall back to rules, and
  the video is still delivered.

## Setup, step by step

### 1. Run migration 0011 (back up first)

```
node backend/scripts/backup-db.js --label=before-0011
```

Then paste all of `backend/database/migrations/0011_video_editor.sql` into
Supabase → SQL Editor and click **Run**.

### 2. Create the free Cloudflare R2 storage

1. Go to **dash.cloudflare.com** and sign up (free).
2. In the left menu, open **R2 Object Storage**. Click to enable R2.
   - Cloudflare asks for a card or PayPal before it turns R2 on, **even on the
     free plan**. You aren't charged while you stay under the free limits: 10 GB
     stored, 1 million uploads and 10 million downloads a month, and
     **downloading is always free**. The app keeps you under these limits: an
     8 GB cap in total, 3 GB per business, and videos deleted after 14 days.
3. Click **Create bucket**.
   - Name: `codecraft-videos`
   - Location: Automatic
   - **Default storage class: Standard.** ⚠ Don't choose *Infrequent Access*:
     it charges for every download, even inside the free 10 GB.
4. Open the bucket → **Settings** → **CORS policy** → **Add CORS policy**, and
   paste this. Put your own Vercel address first:

   ```json
   [
     {
       "AllowedOrigins": ["https://YOUR-APP.vercel.app", "http://localhost:5173"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

5. Back on the R2 page, click **Manage R2 API Tokens** (top right, or under
   "Account details") → **Create API token**.
   - Name: `codecraft-backend`
   - Permissions: **Object Read & Write**
   - Specify bucket(s): **only `codecraft-videos`**
   - TTL: Forever
   - Click **Create API Token**.
6. Cloudflare shows the keys **once**. Copy these two into a safe note:
   - **Access Key ID**
   - **Secret Access Key**
7. Your **Account ID** is on the R2 overview page (right side), and it's also in
   the endpoint address `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
8. Recommended: set a billing alert. Go to **Manage Account → Notifications →
   Add** and pick the usage-based billing alert, so you hear about any charge
   before it happens.

### 3. Make the worker token

On your laptop, in the project folder, run:

```
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

Copy the line it prints. It's the **same value** for Render and your laptop.
Don't share it.

### 4. Add the settings on Render (backend → Environment)

| Key | Value |
|---|---|
| `R2_ACCOUNT_ID` | the Account ID from step 2.7 |
| `R2_ACCESS_KEY_ID` | the Access Key ID from step 2.6 |
| `R2_SECRET_ACCESS_KEY` | the Secret Access Key from step 2.6 |
| `R2_BUCKET` | `codecraft-videos` |
| `VIDEO_WORKER_TOKEN` | the value from step 3 |

Save. Render restarts the backend, which takes about a minute.

### 5. Start the worker on your laptop

In a terminal:

```
cd worker
npm install
npm run setup
```

`npm run setup` does three things:
- downloads the free Whisper program (official whisper.cpp release);
- prepares HyperFrames' headless browser;
- creates `worker/.env`.

Open `worker/.env` and fill in two lines:

```
BACKEND_URL=https://YOUR-BACKEND.onrender.com
VIDEO_WORKER_TOKEN=the value from step 3
```

Start the worker with `npm start`, or double-click `worker/start-worker.bat`.
Keep that window open while you want videos edited. The page in the app then
stops showing "Video editor is offline".

The first video downloads the Whisper model, about 470 MB, once.

**Keep the laptop awake:** Settings → System → Power → Screen and sleep → "When
plugged in, put my device to sleep after: **Never**". If the laptop sleeps
mid-job, the job starts again by itself when the worker is back.

## How long it takes on your laptop

The laptop is an Intel i5-6200U with no graphics card. Quality is never lowered
to go faster, so expect roughly:

| Step | 1 minute of 1080p video |
|---|---|
| Whisper transcription (small.en) | 1–2 min |
| Captions and graphics (HyperFrames) | 5–8 min |
| Top-quality export (CRF 16, slow) | 3–6 min per shape |

A 4K frame takes about 4 times as long. A 10-second clip took about 2 minutes
end to end in testing.

## Moving the worker to Render later (paid, about $7/month)

Create a Render **Background Worker**:
- Runtime: **Docker**
- Root directory: the repo root
- Dockerfile path: `worker/Dockerfile`
- Environment: `BACKEND_URL` and `VIDEO_WORKER_TOKEN`

The code doesn't change. Stop the laptop worker when the Render one is running.
(Both at once also works: each job is only taken once.)

## Troubleshooting

| You see | Do |
|---|---|
| "Video storage isn't set up yet" | The `R2_*` settings are missing on Render (step 4) |
| "Video editor is offline" | Start the worker (step 5); check `BACKEND_URL` |
| Worker says "refused the worker token" | `VIDEO_WORKER_TOKEN` differs between Render and `worker/.env` |
| Upload fails straight away | The R2 CORS policy (step 2.4) doesn't list your app's address |
| "Local Whisper is not installed" | Run `npm run setup` in the worker folder |

Tests: `node backend/tests/video-editor.test.js`; `cd worker && npm test`; and
`node test/e2e.test.js` (the whole flow on this machine, a few minutes).
