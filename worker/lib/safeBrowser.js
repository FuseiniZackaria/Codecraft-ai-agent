const dns = require('dns').promises;
const net = require('net');
const fs = require('fs');
const path = require('path');

/**
 * Read-only website exploring for "make a video of my website".
 *
 * Safety is enforced HERE, in code - not just asked of the AI:
 *   - a fresh private browser per job (no saved logins, cookies or history),
 *     thrown away at the end;
 *   - public websites only: every request's host is checked (after DNS) and
 *     local / private-network / cloud-metadata addresses are refused, so a
 *     link can never reach your laptop's network;
 *   - read-only: requests that change things (POST/PUT/PATCH/DELETE) are
 *     blocked, except the login itself and plain GraphQL "query" reads;
 *   - nothing risky is clicked (delete, pay, buy, checkout, subscribe,
 *     submit, save, send, confirm, cancel, log out, ...) and text is only
 *     typed into the login form;
 *   - stays on the same website; downloads, pop-ups, file pickers and
 *     dialogs are blocked or dismissed;
 *   - 2-factor codes, captchas and "verify you're human" pages are never
 *     bypassed - they're reported honestly.
 *   - login details live only in this function's memory and are never put
 *     in screenshots, logs or files (pages with a password box aren't filmed).
 */

const RISKY = /\b(delete|remove|destroy|erase|pay|payment|checkout|check out|buy|purchase|order now|place order|subscribe|unsubscribe|upgrade|downgrade|billing|cancel|submit|save|send|post|publish|confirm|approve|reject|transfer|withdraw|donate|log ?out|sign ?out|logout|deactivate|close account|reset|invite|share|add to cart|add to bag|book now|reserve|apply now|sign ?up|register|create account)\b/i;
const SKIP_HREF = /\.(pdf|zip|rar|7z|exe|dmg|apk|msi|docx?|xlsx?|pptx?|csv|mp4|mov|mp3|wav)(\?|$)|^(mailto|tel|javascript|sms|whatsapp):|\/(logout|log-out|signout|sign-out|delete|remove|unsubscribe|checkout|cart|billing|payment)s?\b/i;
const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^198\.1[89]\./, /^22[4-9]\.|^2[3-5]\d\./];
const CHALLENGE = /captcha|recaptcha|hcaptcha|turnstile|challenge-platform|cf-chl/i;
const HUMAN_CHECK = /verify (that )?you('| a)re (a )?human|are you a robot|checking your browser|unusual traffic|access denied|attention required/i;
const TWO_FACTOR = /verification code|one[- ]time (pass)?code|two[- ]factor|2fa|authenticator app|enter the code|security code|we sent (you )?a code/i;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return PRIVATE_V4.some((r) => r.test(ip));
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || /^f[cd]|^fe[89ab]/.test(v6) || v6.startsWith('::ffff:') && isPrivateIp(v6.slice(7));
}

const dnsCache = new Map();
async function hostIsPublic(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  // Automated tests serve a demo site on this machine; never set this on a real worker.
  if (process.env.VIDEO_WORKER_TESTS_ALLOW_LOOPBACK === '1' && h === '127.0.0.1') return true;
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal') return false;
  if (net.isIP(h)) return !isPrivateIp(h);
  if (dnsCache.has(h)) return dnsCache.get(h);
  let ok = false;
  try {
    const addrs = await dns.lookup(h, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch { ok = false; }
  dnsCache.set(h, ok);
  return ok;
}

/** "shop.example.co.uk" -> "example.co.uk" (good enough to tell "same website"). */
function siteOf(host) {
  const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.');
  const sld = parts.length >= 3 && /^(co|com|org|net|gov|edu|ac)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-sld).join('.');
}

/** A GraphQL read (not a mutation) may be POSTed: many sites load their content that way. */
function isReadOnlyPost(request) {
  const body = request.postData() || '';
  if (body.length > 20000) return false;
  try {
    const j = JSON.parse(body);
    const qs = (Array.isArray(j) ? j : [j]).map((x) => String(x?.query || ''));
    return qs.length > 0 && qs.every((q) => q && /^\s*(query\b|\{)/.test(q) && !/\bmutation\b/.test(q));
  } catch { return false; }
}

/**
 * Open a private browser session for one job.
 * @param {{ aspect: '9x16'|'16x9', startUrl }} opts
 */
async function openSession({ aspect, startUrl }) {
  const { chromium } = require('playwright');
  const vertical = aspect === '9x16';
  // Sharp screenshots with room to zoom: phone view for 9:16 (1296 px wide), desktop for 16:9 (2880 px wide).
  const viewport = vertical ? { width: 432, height: 768 } : { width: 1440, height: 810 };
  const scale = vertical ? 3 : 2;
  const browser = await chromium.launch({ headless: true, args: ['--disable-features=AutofillServerCommunication'] });
  const context = await browser.newContext({
    viewport, deviceScaleFactor: scale, isMobile: vertical, hasTouch: vertical, acceptDownloads: false,
    locale: 'en-US', colorScheme: 'light', serviceWorkers: 'block',
  });
  const home = siteOf(new URL(startUrl).hostname);
  const state = { loginPhase: false, blockedWrites: 0, offsite: 0, home, notes: new Set() };

  await context.route('**/*', async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.abort(); }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (!['http:', 'https:'].includes(u.protocol) || !(await hostIsPublic(u.hostname))) return route.abort('blockedbyclient');
    const method = req.method();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !state.loginPhase && !(method === 'POST' && isReadOnlyPost(req))) {
      state.blockedWrites += 1;
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage();
  state.page = page;
  context.on('page', (p) => { if (p !== state.page) p.close().catch(() => {}); }); // no pop-ups (after our own tab exists)
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('filechooser', () => {});
  page.setDefaultTimeout(15000);

  const close = async () => { await context.close().catch(() => {}); await browser.close().catch(() => {}); };
  return { page, context, state, viewport, scale, close };
}

const sameSite = (s, url) => { try { return siteOf(new URL(url).hostname) === s.state.home; } catch { return false; } };

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** Close cookie/consent banners with their "accept"/"OK" button (harmless; any write it tries is blocked). */
async function dismissBanners(page) {
  for (const label of [/^(accept|accept all|allow all|i agree|agree|got it|ok|okay|continue)$/i]) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) await btn.click({ timeout: 2000 }).catch(() => {});
  }
}

/** Scroll down slowly (lazy images load), then back to the top. */
async function warmUp(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    const max = Math.min(document.documentElement.scrollHeight, window.innerHeight * 8);
    for (let y = 0; y < max; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
  }).catch(() => {});
  await page.waitForTimeout(400);
}

async function pageProblem(page) {
  const html = (await page.content().catch(() => '')).slice(0, 400000);
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) || '').catch(() => '');
  if (CHALLENGE.test(html) && HUMAN_CHECK.test(text)) return 'a "verify you are human" check (captcha) - it is never bypassed';
  if (HUMAN_CHECK.test(text) && text.length < 1500) return 'the website blocked automated browsing';
  return null;
}

/**
 * Log in (only when the business gave a login). Typing only into this form;
 * the one place a POST is allowed. Returns { ok, note }.
 */
async function login(s, creds, loginUrl) {
  const { page, state } = s;
  try {
    if (loginUrl) { await page.goto(loginUrl, { waitUntil: 'domcontentloaded' }); await settle(page); }
    let pw = page.locator('input[type="password"]:visible').first();
    if (!(await pw.count())) {
      const link = page.getByRole('link', { name: /^(log ?in|sign ?in)$/i }).first();
      if (await link.count()) { await link.click().catch(() => {}); await settle(page); pw = page.locator('input[type="password"]:visible').first(); }
    }
    if (!(await pw.count())) return { ok: false, note: "I couldn't find the login form, so I only showed the public pages." };
    const user = page.locator('input[type="email"]:visible, input[autocomplete="username"]:visible, input[name*="user" i]:visible, input[name*="email" i]:visible, input[type="text"]:visible').first();
    state.loginPhase = true;
    if (await user.count()) await user.fill(creds.username);
    await pw.fill(creds.password);
    await pw.press('Enter');
    await Promise.race([page.waitForNavigation({ timeout: 15000 }).catch(() => {}), page.waitForTimeout(6000)]);
    await settle(page);
    state.loginPhase = false;
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '').catch(() => '');
    if (TWO_FACTOR.test(text) || (await page.locator('input[autocomplete="one-time-code"]').count())) {
      return { ok: false, note: 'The website asked for a 2-factor code, which the video editor can never enter - so only the public pages are in the video. A demo account without 2-factor login works best.' };
    }
    if (await page.locator('input[type="password"]:visible').count()) {
      return { ok: false, note: 'The login did not work (wrong details, or an extra check) - so only the public pages are in the video.' };
    }
    return { ok: true, note: null };
  } catch (err) {
    state.loginPhase = false;
    return { ok: false, note: `Logging in didn't work (${String(err.message).split('\n')[0].slice(0, 120)}), so only the public pages are in the video.` };
  } finally {
    // The details are not needed any more.
    creds.password = '';
    creds.username = '';
  }
}

/** Links to explore next: same website, nav/header first, no risky or file links. */
async function linksOn(s) {
  const raw = await s.page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const inNav = !!a.closest('nav, header, [role="navigation"], menu');
      const text = (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      out.push({ href: a.href, text, inNav });
    }
    return out;
  }).catch(() => []);
  const seen = new Set();
  return raw
    .filter((l) => l.href && sameSite(s, l.href) && !SKIP_HREF.test(l.href) && !RISKY.test(l.text))
    .map((l) => { const u = new URL(l.href); u.hash = ''; return { ...l, href: u.toString(), key: u.pathname.replace(/\/$/, '') || '/' }; })
    .filter((l) => (seen.has(l.key) ? false : (seen.add(l.key), true)))
    .sort((a, b) => Number(b.inNav) - Number(a.inNav));
}

/** Things worth clicking to show a feature (tabs, accordions, safe buttons) - never risky ones, never inside forms. */
async function clickables(s, max = 4) {
  const items = await s.page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="tab"], summary, [aria-expanded="false"], button, [role="button"]')];
    return els.map((el, i) => {
      const r = el.getBoundingClientRect();
      const label = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
      const inForm = !!el.closest('form');
      const submit = el.getAttribute('type') === 'submit';
      return { i, label, x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height, inForm, submit, visible: r.width > 8 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden' };
    }).filter((x) => x.visible && x.label.length >= 2 && !x.inForm && !x.submit);
  }).catch(() => []);
  return items.filter((x) => !RISKY.test(x.label) && !/menu|close|×|cookie|accept|language|search/i.test(x.label)).slice(0, max);
}

async function hasPasswordBox(page) {
  return (await page.locator('input[type="password"]:visible').count().catch(() => 0)) > 0;
}

/**
 * Explore the website. Saves screenshots into `dir` and returns what was seen.
 * @returns {{ pages: [...], notes: string[], blockedWrites: number }}
 */
async function explore({ startUrl, aspect, dir, creds = null, loginUrl = null, maxPages = 8, clicksPerPage = 4, onProgress = () => {} }) {
  if (!(await hostIsPublic(new URL(startUrl).hostname))) throw new Error('That website address points to a private or local network, which the video editor never opens.');
  const s = await openSession({ aspect, startUrl });
  const notes = [];
  const pages = [];
  try {
    const { page, viewport, scale } = s;
    const resp = await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page);
    if (resp && resp.status() >= 400) notes.push(`The website answered with an error (${resp.status()}).`);
    const blocked = await pageProblem(page);
    if (blocked) { notes.push(`The website showed ${blocked}, so it couldn't be explored.`); return { pages, notes, blockedWrites: s.state.blockedWrites }; }
    await dismissBanners(page);

    if (creds) {
      onProgress('Logging in (demo account recommended)');
      const r = await login(s, creds, loginUrl);
      if (r.note) notes.push(r.note);
      if (!r.ok) { await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {}); await settle(page); }
    }

    const queue = [{ href: page.url(), text: 'Home' }];
    for (const l of await linksOn(s)) queue.push(l);
    const visited = new Set();
    for (const target of queue) {
      if (pages.length >= maxPages) break;
      const key = (() => { try { const u = new URL(target.href); return u.pathname.replace(/\/$/, '') || '/'; } catch { return null; } })();
      if (!key || visited.has(key)) continue;
      visited.add(key);
      onProgress(`Page ${pages.length + 1}: ${target.text || key}`);
      try {
        if (page.url() !== target.href) { await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 25000 }); await settle(page); }
        if (!sameSite(s, page.url())) { s.state.offsite += 1; continue; }
        if (await pageProblem(page)) continue;
        if (await hasPasswordBox(page)) continue; // never film a login form
        await dismissBanners(page);
        await warmUp(page);
        const p = pages.length;
        const info = await page.evaluate(() => ({
          title: document.title,
          headings: [...document.querySelectorAll('h1, h2, h3')].map((h) => h.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 20),
          text: (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').trim().slice(0, 1500),
          height: Math.min(document.documentElement.scrollHeight, window.innerHeight * 6),
          layoutWidth: window.innerWidth, // a page without a mobile viewport tag is laid out wider than the screen
        }));
        const shot = `page${p}.png`;
        await page.screenshot({ path: path.join(dir, shot), clip: { x: 0, y: 0, width: Math.max(viewport.width, info.layoutWidth || 0), height: Math.max(viewport.height, info.height) }, fullPage: true });
        const thumb = `thumb${p}.jpg`;
        await page.screenshot({ path: path.join(dir, thumb), type: 'jpeg', quality: 70, scale: 'css' });
        // Feature clicks: an "after" screenshot for each (the page is reloaded between them).
        const clicks = [];
        for (const [ci, c] of (clicksPerPage ? await clickables(s, clicksPerPage) : []).entries()) {
          try {
            const el = page.locator('[role="tab"], summary, [aria-expanded="false"], button, [role="button"]').nth(c.i);
            await el.scrollIntoViewIfNeeded({ timeout: 3000 });
            const before = await page.evaluate(() => window.scrollY);
            await el.click({ timeout: 3000, trial: false });
            await page.waitForTimeout(900);
            if (!sameSite(s, page.url()) || (await hasPasswordBox(page))) { await page.goBack().catch(() => {}); await settle(page); continue; }
            const after = `page${p}-click${ci}.png`;
            await page.screenshot({ path: path.join(dir, after) });
            clicks.push({ c: ci, label: c.label, box: { x: c.x, y: c.y, w: c.w, h: c.h }, scrollY: before, shot: after });
            await page.goto(target.href, { waitUntil: 'domcontentloaded' });
            await settle(page);
          } catch { /* that one didn't work - skip it */ }
        }
        pages.push({ p, url: page.url(), title: info.title, headings: info.headings, text: info.text, shot, thumb, height: info.height, width: info.layoutWidth || viewport.width, scale, clicks });
        if (pages.length === 1) for (const l of await linksOn(s)) queue.push(l);
      } catch (err) {
        notes.push(`${target.text || key}: couldn't be opened (${String(err.message).split('\n')[0].slice(0, 80)}).`);
      }
    }
    if (s.state.blockedWrites) notes.push(`Read-only: ${s.state.blockedWrites} attempt(s) by the site to save or change something were blocked.`);
    if (!pages.length && !notes.length) notes.push('No page of the website could be shown.');
    return { pages, notes, blockedWrites: s.state.blockedWrites };
  } finally {
    await s.close();
  }
}

/** For "edit my video my way": a few screenshots of a reference website (public pages only, no login). */
async function referenceShots({ url, aspect, dir, max = 3 }) {
  const r = await explore({ startUrl: url, aspect, dir, maxPages: max, clicksPerPage: 0 });
  return r;
}

module.exports = { explore, referenceShots, hostIsPublic, isPrivateIp, siteOf, isReadOnlyPost, RISKY, SKIP_HREF };
