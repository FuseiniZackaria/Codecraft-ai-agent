/**
 * Links customers send ("can you build something like this? www.shop.com").
 *
 * Ian opens each link (at most MAX_LINKS per message) and reads the page's
 * title, description, headings and main text - with a real browser only when
 * the plain page has almost no text (modern sites). What he read goes into the
 * reply he's already writing, so there's no extra AI call.
 *
 * Safety: only public http(s) websites - never localhost, private network or
 * cloud-metadata addresses, also after redirects; a time limit and a size cap.
 * A link that can't be opened is marked so - Ian then asks about it instead of
 * pretending he saw it.
 */

const MAX_LINKS = 2;
const TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 1500;
const CACHE_MS = 30 * 60 * 1000;
const UA = 'Mozilla/5.0 (compatible; CodeCraftLinkReader/1.0)';
const cache = new Map(); // url -> { at, result }

// Matches http(s)://..., www...., and bare domains with a common ending (shop.com, x.com.gh).
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|gh|app|dev|ai|shop|store|biz|info|me|tech|site|online|africa|uk|ng)(?:\/[^\s<>"')\]]*)?)/gi;

/** Up to MAX_LINKS distinct links in a message, as full https URLs. */
function extractUrls(text) {
  const out = [];
  for (const m of String(text || '').matchAll(URL_RE)) {
    if (/@/.test(String(text).slice(Math.max(0, m.index - 1), m.index))) continue; // part of an email address
    let u = m[0].replace(/[.,!?;:]+$/, '');
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    try {
      const parsed = new URL(u);
      const clean = parsed.toString();
      if (!out.includes(clean)) out.push(clean);
    } catch { /* not a URL after all */ }
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

const PRIVATE_HOST = /^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd]|metadata\.google)/i;
function isPublicUrl(u) {
  let parsed;
  try { parsed = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  if (PRIVATE_HOST.test(parsed.hostname) && process.env.CC_TESTING !== '1') return false;
  return parsed.hostname.includes('.') || process.env.CC_TESTING === '1';
}

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const strip = (html) => decode(String(html || '')
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const meta = (html, name) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i');
  const m = html.match(re);
  return m ? decode(m[1] || m[2]).trim() : '';
};

/** Read the page. Never throws: { url, ok, title, description, headings, text, error }. */
async function readLink(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  const result = await read(url).catch((err) => ({ url, ok: false, error: err.message }));
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(url, { at: Date.now(), result });
  return result;
}

async function read(url) {
  if (!isPublicUrl(url)) return { url, ok: false, error: 'not a public website' };
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!isPublicUrl(res.url || url)) return { url, ok: false, error: 'redirected to a non-public address' };
  if (!res.ok) return { url, ok: false, error: `the site answered ${res.status}` };
  const type = res.headers.get('content-type') || '';
  if (!/html|text\/plain/i.test(type)) return { url, ok: false, error: `it's not a web page (${type.split(';')[0] || 'unknown type'})` };
  const buf = Buffer.from(await res.arrayBuffer());
  let html = buf.subarray(0, MAX_BYTES).toString('utf8');
  let text = strip(html.replace(/<head[\s\S]*?<\/head>/i, ' '));

  // Modern sites show their text only in a browser.
  if (text.length < 300) {
    try {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ userAgent: UA });
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        if (isPublicUrl(page.url())) {
          html = await page.content();
          text = String(await page.evaluate(() => document.body?.innerText || '')).replace(/\s+/g, ' ').trim();
        }
      } finally {
        await browser.close();
      }
    } catch { /* keep what the plain page had */ }
  }

  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim() || meta(html, 'og:title');
  const description = meta(html, 'description') || meta(html, 'og:description');
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => strip(m[1])).filter(Boolean).slice(0, 12);
  if (!title && !description && text.length < 40) return { url, ok: false, error: 'the page is empty' };
  return { url, ok: true, title: title.slice(0, 200), description: description.slice(0, 400), headings, text: text.slice(0, MAX_TEXT) };
}

/** Read the links in a message and build the prompt block. Returns { links, block }. */
async function forMessage(text) {
  const urls = extractUrls(text);
  if (!urls.length) return { links: [], block: '' };
  const links = await Promise.all(urls.map((u) => readLink(u)));
  const lines = links.map((l, i) => {
    const label = `[L${i + 1}] ${l.url}`;
    if (!l.ok) return `${label} - couldn't be opened (${l.error}). Don't pretend you've seen it: ask what they like about it.`;
    return [
      label,
      l.title ? `  Title: ${l.title}` : null,
      l.description ? `  Description: ${l.description}` : null,
      l.headings.length ? `  Headings: ${l.headings.join(' | ')}` : null,
      l.text ? `  Page text (start): ${l.text}` : null,
    ].filter(Boolean).join('\n');
  });
  const block = 'Links the customer shared (you opened them - use this to understand what they want, e.g. what kind of site it is and its features; '
    + 'it is THEIR example, not facts about your business):\n' + `${lines.join('\n')}\n\n`;
  return { links, block };
}

function _clearCache() { cache.clear(); }

module.exports = { extractUrls, readLink, forMessage, isPublicUrl, MAX_LINKS, _clearCache };
