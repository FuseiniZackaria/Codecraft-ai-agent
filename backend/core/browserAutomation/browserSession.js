const { chromium } = require('playwright');
const config = require('../../config');

/**
 * browserSession.js - navigate, read, screenshot, plus the form-filling
 * actions used by JobApplicationAgent (fill/click/submit run only after an
 * explicit approval on the Tasks page).
 *
 * Uses launchPersistentContext against config.browserAutomation.userDataDir
 * - a dedicated, isolated Chromium profile with no saved logins, cookies,
 * or autofill from the user's real browser. One shared page instance is
 * reused across calls within a session, so a multi-step task (navigate,
 * then read) sees the same page rather than starting fresh each time.
 *
 * Reading is built to catch contact details reliably: navigate() waits for
 * the full load, scrolls slowly to the bottom so footers and lazy sections
 * render, then pauses; readPage() keeps the footer even when it has to cut
 * a long page, and returns every email/phone it can find as `contacts`.
 */

let context = null;
let page = null;

// Long pages are cut to this many characters, keeping the start AND the end
// (where footers with contact details live).
const MAX_PAGE_CHARS = 24000;
const PAGE_TAIL_CHARS = 8000;

async function getPage() {
  if (page && !page.isClosed()) return page;
  context = await chromium.launchPersistentContext(config.browserAutomation.userDataDir, {
    headless: config.browserAutomation.headless,
  });
  page = context.pages()[0] || (await context.newPage());
  return page;
}

/**
 * Scroll the page (or its main scrolling container) to the bottom in small
 * steps, waiting between each so lazy-loaded sections and footers render.
 * Stops once the bottom stays put for a few steps, or after ~15s.
 */
async function scrollToBottom(p) {
  await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Some sites scroll an inner container instead of the window.
    const candidates = [document.scrollingElement || document.documentElement, ...document.querySelectorAll('body *')]
      .filter((el) => {
        if (!el || el.scrollHeight <= el.clientHeight + 50) return false;
        if (el === document.scrollingElement || el === document.documentElement) return true;
        const style = getComputedStyle(el);
        return /(auto|scroll)/.test(style.overflowY) && el.clientHeight > window.innerHeight * 0.5;
      });
    const scroller = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || document.scrollingElement;
    const started = Date.now();
    let atBottomCount = 0;
    while (Date.now() - started < 15000 && atBottomCount < 3) {
      scroller.scrollBy(0, Math.max(300, window.innerHeight * 0.6));
      await sleep(250);
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      atBottomCount = atBottom ? atBottomCount + 1 : 0;
    }
  });
}

/**
 * Open a page and wait until it is fully loaded: the load event, a short
 * best-effort wait for network quiet (some pages poll forever, so it's
 * capped), a slow scroll to the bottom, then a brief pause for anything the
 * scroll triggered. Pass { scroll: false } to skip the scroll.
 */
async function navigate(url, { scroll = true } = {}) {
  if (!url || typeof url !== 'string') throw new Error('navigate requires a "url"');
  const target = /^https?:\/\//i.test(url) ? url : `https://${url.trim()}`;
  const p = await getPage();
  let response;
  try {
    response = await p.goto(target, { waitUntil: 'load', timeout: 30000 });
  } catch (err) {
    if (/interrupted by another navigation/i.test(err.message)) {
      // The shared tab was still settling on a previous page (e.g. an error page
      // from a site that didn't resolve) - let it finish, then go again.
      await p.waitForTimeout(500);
      response = await p.goto(target, { waitUntil: 'load', timeout: 30000 });
    } else if (/Timeout/i.test(err.message)) {
      // A page whose load event never fires (endless trackers) is still usable once the DOM is in.
      response = await p.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      throw err;
    }
  }
  try { await p.waitForLoadState('networkidle', { timeout: 6000 }); } catch { /* best effort */ }
  if (scroll) {
    try { await scrollToBottom(p); } catch { /* page navigated away mid-scroll - read what is there */ }
  }
  await p.waitForTimeout(scroll ? 1500 : 2500);
  return { status: 'navigated', httpStatus: response?.status() ?? null, url: p.url(), title: await p.title() };
}

/**
 * Every contact detail on the current page: mailto:/tel: links, emails and
 * phone numbers in the visible text, and Cloudflare-protected emails (shown
 * as "[email protected]" with the real address encoded in the page).
 * Also lists same-site links that look like contact/about pages.
 */
async function extractContacts(p) {
  return p.evaluate(() => {
    const emails = new Set();
    const phones = new Set();
    const text = document.body ? document.body.innerText : '';

    const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const NOT_EMAIL_TLD = /\.(png|jpe?g|gif|svg|webp|avif|css|js|ico)$/i;
    const addEmail = (raw) => {
      const e = String(raw || '').trim().replace(/^mailto:/i, '').split('?')[0].replace(/[.,;:]+$/, '').toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) && !NOT_EMAIL_TLD.test(e)) emails.add(decodeURIComponent(e));
    };
    const addPhone = (raw) => {
      const p = String(raw || '').replace(/^tel:/i, '').trim();
      const digits = p.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) phones.add(p.replace(/\s+/g, ' '));
    };

    // Cloudflare email obfuscation: hex string, first byte is the XOR key.
    const decodeCf = (hex) => {
      try {
        const key = parseInt(hex.slice(0, 2), 16);
        let out = '';
        for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
        return out;
      } catch { return ''; }
    };

    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (/^mailto:/i.test(href)) addEmail(href);
      else if (/^tel:/i.test(href)) addPhone(href);
      else if (href.includes('/cdn-cgi/l/email-protection#')) addEmail(decodeCf(href.split('#')[1] || ''));
    }
    for (const el of document.querySelectorAll('[data-cfemail]')) addEmail(decodeCf(el.getAttribute('data-cfemail')));

    for (const m of text.match(EMAIL) || []) addEmail(m);
    // Visible "name [at] domain [dot] com" style addresses.
    for (const m of text.matchAll(/([A-Z0-9._%+-]+)\s*[[(]\s*at\s*[\])]\s*([A-Z0-9-]+(?:\s*[[(]\s*dot\s*[\])]\s*[A-Z0-9-]+)+)/gi)) {
      addEmail(`${m[1]}@${m[2].replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.')}`);
    }
    // Phone numbers in text: international (+...) or typically formatted local
    // numbers. Plain digit runs (years, prices, ids) are left out on purpose.
    const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{2,4}[\s.-]\d{2,5}(?:[\s.-]\d{1,4})?/g;
    for (const m of text.match(PHONE) || []) {
      const digits = m.replace(/\D/g, '');
      const looksLikeDate = /^\d{4}[\s.-]\d{1,2}[\s.-]\d{1,2}$/.test(m.trim()) || /^\d{1,2}[\s.-]\d{1,2}[\s.-]\d{2,4}$/.test(m.trim());
      if ((m.trim().startsWith('+') || digits.length >= 9) && !looksLikeDate) addPhone(m);
    }

    // Same-site links that look like contact or about pages, contact first.
    const here = location.hostname.replace(/^www\./, '');
    const seen = new Set();
    const contactPages = [];
    for (const a of document.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(a.getAttribute('href'), location.href); } catch { continue; }
      if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, '') !== here) continue;
      url.hash = '';
      const label = `${a.innerText || ''} ${url.pathname}`.toLowerCase();
      const rank = /contact|get in touch|reach (us|me)|enquir|inquir/.test(label) ? 0 : /about|team|impressum|imprint/.test(label) ? 1 : -1;
      if (rank < 0 || seen.has(url.href) || url.href === location.href.split('#')[0]) continue;
      seen.add(url.href);
      contactPages.push({ url: url.href, rank });
    }
    contactPages.sort((a, b) => a.rank - b.rank);

    return { emails: [...emails], phones: [...phones], contactPages: contactPages.map((c) => c.url).slice(0, 5) };
  });
}

/** Footer text, so it can be kept when a long page has to be cut. */
async function footerText(p) {
  return p.evaluate(() => {
    const els = document.querySelectorAll('footer, [role="contentinfo"], #footer, .footer, .site-footer');
    return [...els].map((el) => el.innerText.trim()).filter(Boolean).join('\n');
  });
}

/**
 * The whole visible text of the current page plus its contact details.
 * Pages over MAX_PAGE_CHARS keep the start and the end, and the footer is
 * always included, so contact details at the bottom are never cut off.
 */
async function readPage() {
  const p = await getPage();
  const full = (await p.evaluate(() => (document.body ? document.body.innerText : ''))).trim();
  const contacts = await extractContacts(p);
  let text = full;
  let truncated = false;
  if (full.length > MAX_PAGE_CHARS) {
    truncated = true;
    const tail = full.slice(-PAGE_TAIL_CHARS);
    const footer = (await footerText(p)).slice(0, 4000);
    const footerMissing = footer && !tail.includes(footer.slice(0, 200));
    const headChars = MAX_PAGE_CHARS - PAGE_TAIL_CHARS - (footerMissing ? footer.length : 0);
    text =
      `${full.slice(0, Math.max(4000, headChars))}\n\n[...middle of the page omitted...]\n\n${tail}` +
      (footerMissing ? `\n\n[Footer]\n${footer}` : '');
  }
  return { url: p.url(), title: await p.title(), text, truncated, contacts };
}

/** One readable block listing the contact details found, for the agent's text output. */
function formatContactBlock({ emails, phones, pagesChecked }) {
  return [
    '=== CONTACT DETAILS FOUND ===',
    `Emails: ${emails.length ? emails.join(', ') : 'none found'}`,
    `Phones: ${phones.length ? phones.join(', ') : 'none found'}`,
    `Pages checked: ${pagesChecked.join(', ')}`,
    '=============================',
  ].join('\n');
}

/**
 * Read a site and collect its contact details. Opens `url`; if that page
 * has no email address, opens the site's contact page (then about page) and
 * checks there too - up to `maxExtraPages`. Returns the first page's text,
 * the extra pages' text, and one merged contact list, with the contact
 * block at the start and end of `text` so it survives any later trimming.
 */
async function findContacts(url, { maxExtraPages = 2 } = {}) {
  const nav = await navigate(url);
  const first = await readPage();
  const emails = new Set(first.contacts.emails);
  const phones = new Set(first.contacts.phones);
  const pagesChecked = [first.url];
  const extraPages = [];

  let candidates = first.contacts.contactPages;
  if (!candidates.length) {
    // No contact/about links found in the page - try the usual paths.
    const origin = new URL(first.url).origin;
    candidates = ['/contact', '/contact-us', '/about'].map((path) => origin + path);
  }
  for (const next of candidates) {
    if (emails.size || extraPages.length >= maxExtraPages) break;
    try {
      const res = await navigate(next);
      if (res.httpStatus && res.httpStatus >= 400) continue;
      const extra = await readPage();
      pagesChecked.push(extra.url);
      extra.contacts.emails.forEach((e) => emails.add(e));
      extra.contacts.phones.forEach((ph) => phones.add(ph));
      extraPages.push({ url: extra.url, title: extra.title, text: extra.text.slice(0, 8000) });
    } catch (err) {
      console.warn(`[browserSession] findContacts: could not open ${next}: ${err.message}`);
    }
  }

  const contacts = { emails: [...emails], phones: [...phones], pagesChecked };
  const block = formatContactBlock(contacts);
  const pages = [
    `PAGE: ${first.url} - ${first.title}${first.truncated ? ' (long page: start and end, including footer, shown)' : ''}\n${first.text}`,
    ...extraPages.map((x) => `PAGE: ${x.url} - ${x.title}\n${x.text}`),
  ];
  return {
    url: first.url,
    title: first.title,
    httpStatus: nav.httpStatus,
    truncated: first.truncated,
    contacts,
    text: `${block}\n\n${pages.join('\n\n')}\n\n${block}`,
  };
}

async function screenshot() {
  const p = await getPage();
  const buffer = await p.screenshot();
  return { status: 'captured', url: p.url(), base64: buffer.toString('base64') };
}

/**
 * Returns every fillable form field on the current page with its best-guess
 * label and a CSS selector we can reliably target later.
 * Used by JobApplicationAgent to understand what a form is asking for
 * before mapping the applicant profile onto it.
 */
async function getFormFields() {
  const p = await getPage();
  return await p.evaluate(() => {
    const fields = [];
    const els = document.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),' +
      'textarea, select'
    );
    els.forEach((el) => {
      // Best-effort label: <label for=id>, wrapping <label>, placeholder, aria-label, name
      const labelEl =
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
        el.closest('label');
      const label =
        labelEl?.innerText?.trim() ||
        el.getAttribute('placeholder') ||
        el.getAttribute('aria-label') ||
        el.getAttribute('name') ||
        '';

      // Prefer id selector, then name, skip elements with no stable selector
      const selector = el.id
        ? `#${el.id}`
        : el.name
        ? `[name="${el.name}"]`
        : null;
      if (!selector) return;

      fields.push({
        selector,
        label:    label.replace(/\s+/g, ' ').slice(0, 120),
        type:     el.type || el.tagName.toLowerCase(),
        name:     el.name || el.id || '',
        required: el.required || false,
      });
    });
    return fields;
  });
}

/**
 * Fills a single form field identified by `selector` with `value`.
 * Works for text inputs, textareas, and select elements.
 */
async function fillField(selector, value) {
  const p = await getPage();
  const safe = toPlaywrightSelector(selector);
  await p.waitForSelector(safe, { timeout: 8000 });
  const el = await p.$(safe);
  if (!el) throw new Error(`fillField: selector "${selector}" not found`);

  const tagName = await el.evaluate((n) => n.tagName.toLowerCase());
  if (tagName === 'select') {
    await el.selectOption({ label: value });
  } else {
    await el.click({ clickCount: 3 }); // select all existing text
    await el.fill(value);
  }
  return { filled: safe, value };
}

/**
 * Clicks any element on the page — buttons, checkboxes, links, etc.
 */
async function clickElement(selector) {
  const p = await getPage();
  const safe = toPlaywrightSelector(selector);
  await p.waitForSelector(safe, { timeout: 8000 });
  await p.click(safe);
  return { clicked: safe };
}

/**
 * Fills every field in `fields` array then clicks the submit selector.
 * This is the single irreversible "apply" action — called only after an
 * explicit human approval on the Tasks page.
 *
 * @param {Array<{selector:string, value:string}>} fields
 * @param {string} submitSelector - CSS selector of the submit button
 */
// Playwright supports :has-text() but not jQuery's :contains().
// The LLM often produces :contains() — normalise it before use.
function toPlaywrightSelector(selector) {
  return (selector || '')
    .replace(/:contains\(["']?([^"')]+)["']?\)/gi, ':has-text("$1")')
    .trim();
}

async function applyForJob(fields, submitSelector) {
  for (const { selector, value } of fields) {
    try {
      await fillField(toPlaywrightSelector(selector), String(value));
    } catch (err) {
      console.warn(`[browserSession] applyForJob: could not fill "${selector}": ${err.message}`);
    }
  }
  const p = await getPage();
  const safeSubmit = toPlaywrightSelector(submitSelector);
  // Try the LLM-provided selector first; fall back to common submit patterns.
  const submitCandidates = [
    safeSubmit,
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Apply")',
    'button:has-text("Send application")',
  ];
  let clicked = false;
  for (const sel of submitCandidates) {
    try {
      await p.waitForSelector(sel, { timeout: 4000 });
      await p.click(sel);
      clicked = true;
      break;
    } catch {
      // try next candidate
    }
  }
  if (!clicked) throw new Error(`Could not find a submit button. Tried: ${submitCandidates.join(', ')}`);
  // Brief wait to let the page respond before we try to read confirmation
  await p.waitForTimeout(2000);
  const title = await p.title();
  const text  = (await p.evaluate(() => document.body.innerText)).slice(0, 1000);
  return { submitted: true, pageTitle: title, pageSnippet: text };
}

async function closeSession() {
  if (context) await context.close();
  context = null;
  page = null;
}

module.exports = {
  navigate,
  readPage,
  findContacts,
  screenshot,
  getFormFields,
  fillField,
  clickElement,
  applyForJob,
  closeSession,
};