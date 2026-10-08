const { chromium } = require('playwright');
const config = require('../../config');

/**
 * browserSession.js - Stage 12 (MVP slice): navigate, read, and screenshot
 * only. Deliberately NOT clicking/filling/submitting yet - those need an
 * observe-act-observe loop (see a page's real content before deciding what
 * to click), which is a meaningfully bigger piece to get right and is
 * being built as a separate follow-up once this foundation is verified
 * working on a real machine.
 *
 * Uses launchPersistentContext against config.browserAutomation.userDataDir
 * - a dedicated, isolated Chromium profile with no saved logins, cookies,
 * or autofill from the user's real browser. One shared page instance is
 * reused across calls within a session, so a multi-step task (navigate,
 * then read) sees the same page rather than starting fresh each time.
 */

let context = null;
let page = null;

async function getPage() {
  if (page && !page.isClosed()) return page;
  context = await chromium.launchPersistentContext(config.browserAutomation.userDataDir, {
    headless: config.browserAutomation.headless,
  });
  page = context.pages()[0] || (await context.newPage());
  return page;
}

async function navigate(url) {
  if (!url || typeof url !== 'string') throw new Error('navigate requires a "url"');
  const p = await getPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Give SPAs (Lever, Greenhouse, Workday, etc.) time to render their forms
  // after the initial HTML loads. networkidle can hang on pages with polling
  // so a fixed 2.5s pause is the safer trade-off here.
  try { await p.waitForLoadState('load', { timeout: 8000 }); } catch { /* best effort */ }
  await p.waitForTimeout(2500);
  return { status: 'navigated', url: p.url(), title: await p.title() };
}

async function readPage() {
  const p = await getPage();
  const text = await p.evaluate(() => document.body.innerText);
  // Capped to keep a single page's text from blowing out an LLM call's
  // token budget the same way long filenames did in stage 5/6/7 - a
  // hard slice here, not a summarization judgment call.
  return { url: p.url(), title: await p.title(), text: text.slice(0, 8000), truncated: text.length > 8000 };
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
  screenshot,
  getFormFields,
  fillField,
  clickElement,
  applyForJob,
  closeSession,
};