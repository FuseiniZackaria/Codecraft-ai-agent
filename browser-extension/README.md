# CodeCraft AI - Browser Reporter

Reports the site you're currently viewing to your local CodeCraft AI backend, so other parts of the system (future MCP/CLI detection, etc.) can know what you're looking at.

This is step 1 of 3 toward "detect if a site has an MCP server or CLI I can connect to." This piece only does the reporting - detection logic is a separate build on top of this.

## What it does and doesn't do

- Watches tab navigation (switching tabs, loading a new page) and sends the URL + title to your backend.
- Does **not** inject anything into pages, read page content, or see anything beyond the URL/title Chrome already exposes for the active tab.
- Sends nothing anywhere except the backend URL you configure (defaults to `http://localhost:4000`).

## 1. Set a pairing token on the backend

In `backend/.env`, set:

```
BROWSER_EXTENSION_TOKEN=some-random-string-you-make-up
```

Restart the backend (`npm run dev` from the project root) after setting it. Without this set, the backend rejects every request from the extension - it fails closed by design, not open.

## 2. Load the extension in Chrome

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this `browser-extension/` folder

## 3. Pair it

1. Click the extension's icon in your toolbar
2. Paste the **same** `BROWSER_EXTENSION_TOKEN` value into the token field
3. Leave the backend URL as `http://localhost:4000` unless you've changed the port
4. Click **Save** - it makes a real request to confirm the token works before saying "paired"

## Checking it's working

Switch tabs or load a new page, then either:
- Reopen the popup - "Last reported" should show the page you're on
- Or check directly: `curl http://localhost:4000/api/browser/current -H "X-CodeCraft-Token: <your token>"`

## Badge states (on the extension icon)

- No badge, green: last report succeeded
- Amber `!`: no token saved yet
- Red `!`: backend rejected the token (mismatch)
- Grey `x`: backend unreachable (not running, wrong port)
