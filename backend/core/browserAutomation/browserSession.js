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

async function closeSession() {
  if (context) await context.close();
  context = null;
  page = null;
}

module.exports = { navigate, readPage, screenshot, closeSession };