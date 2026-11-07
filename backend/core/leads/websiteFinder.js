/**
 * Find a lead's own website when the search results didn't show one.
 *
 * Search snippets rarely include the link in an Instagram / Facebook / TikTok
 * bio, so a business that HAS a website looked like it didn't (and would be
 * pitched "you need a website"). For a lead with no website:
 *   1. open its social profile(s) and read the bio link (Instagram's
 *      external_url / bio_links, a Linktree-style page, or any outside link);
 *   2. otherwise one quick search for "<name> <location> official website",
 *      keeping only a result whose address matches the business's name.
 * Only public http(s) pages are opened (same safety rules as the WhatsApp
 * link reader), with a time limit. Never throws.
 */

const { isPublicUrl } = require('../whatsapp/linkReader');

const TIMEOUT_MS = 8000;
const MAX_BYTES = 1.5 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Not a business's own website: social networks, link pages, maps, directories, delivery apps, stores, CDNs.
const NOT_OWN_SITE = /(^|\.)(instagram|facebook|fb|fbcdn|cdninstagram|tiktok|twitter|x|threads|linkedin|youtube|youtu|pinterest|snapchat|whatsapp|wa|telegram|t|google|goo|googleusercontent|gstatic|apple|microsoft|bing|yelp|tripadvisor|foursquare|zomato|ubereats|glovoapp|bolt|jumia|tonaton|jiji|ghanayello|businessghana|ghanabusinessweb|yellowpagesghana|vymaps|cybo|wikipedia|amazon|gmail|outlook|yahoo|w3|schema|cloudflare|gravatar|wixstatic|squarespace-cdn|shopify-cdn)\.[a-z.]+$/i;
const LINK_PAGE = /(^|\.)(linktr\.ee|beacons\.ai|bio\.link|lnk\.bio|linkin\.bio|campsite\.bio|tap\.bio|msha\.ke|carrd\.co|withkoji\.com|solo\.to)$/i;

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const isLinkPage = (u) => LINK_PAGE.test(host(u));
const isOwnSiteCandidate = (u) => {
  const h = host(u);
  return !!h && h.includes('.') && !NOT_OWN_SITE.test(h) && !isLinkPage(u) && isPublicUrl(u);
};
const clean = (u) => String(u || '').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/[)\].,;'"]+$/, '');

/** Instagram / Facebook "l.instagram.com/?u=<real url>" redirect wrappers -> the real url. */
function unwrap(u) {
  try {
    const url = new URL(u);
    const inner = url.searchParams.get('u') || url.searchParams.get('url');
    if (inner && /^(l\.instagram\.com|l\.facebook\.com|lm\.facebook\.com)$/.test(url.hostname)) return decodeURIComponent(inner);
  } catch { /* not a url */ }
  return u;
}

async function fetchHtml(url) {
  if (!isPublicUrl(url)) return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok || !isPublicUrl(res.url || url)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, MAX_BYTES).toString('utf8');
  } catch {
    return null;
  }
}

/** Outside links a profile page shows: Instagram's bio link fields first, then any link or URL in the page. */
function linksInProfile(html) {
  const found = [];
  const push = (u) => { const c = clean(unwrap(clean(u))); if (/^https?:\/\//i.test(c) && !found.includes(c)) found.push(c); };
  for (const m of html.matchAll(/"(?:external_url|website|url)"\s*:\s*"(https?:[^"]+)"/g)) push(m[1]);
  for (const m of html.matchAll(/"bio_links"\s*:\s*\[([^\]]*)\]/g)) for (const u of m[1].matchAll(/"url"\s*:\s*"(https?:[^"]+)"/g)) push(u[1]);
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) push(m[1]);
  // The bio text itself (og:description often carries it): "… www.mysite.com …"
  const desc = (html.match(/<meta[^>]+(?:property|name)=["'](?:og:)?description["'][^>]*content=["']([^"']*)["']/i) || [])[1] || '';
  for (const m of desc.matchAll(/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|co|gh|com\.gh|africa|shop|store|biz|io|ng)(?:\/[^\s"'<]*)?)/gi)) {
    push(/^https?:/i.test(m[1]) ? m[1] : `https://${m[1]}`);
  }
  return found;
}

/** The business's own site from its profile page (following one Linktree-style page), or null. */
async function fromProfile(profileUrl) {
  const html = await fetchHtml(profileUrl);
  if (!html) return null;
  const links = linksInProfile(html);
  const own = links.find(isOwnSiteCandidate);
  if (own) return own;
  const linkPage = links.find(isLinkPage);
  if (linkPage) {
    const page = await fetchHtml(linkPage);
    if (page) return linksInProfile(page).find(isOwnSiteCandidate) || null;
  }
  return null;
}

/** Does this address plausibly belong to the business? ("Big-B Restaurant" ~ bigbrestaurant.com) */
function matchesName(url, name) {
  const h = host(url).split('.')[0].replace(/[^a-z0-9]/g, '');
  const words = String(name || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !['the', 'and', 'ltd', 'limited', 'services', 'service', 'company', 'enterprise', 'ghana', 'restaurant', 'catering'].includes(w));
  if (!h || !words.length) return false;
  return words.some((w) => h.includes(w)) || h.includes(words.join('').slice(0, 8));
}

/**
 * Find a website for one lead. search: optional async (query) => [{ url, title }].
 * Returns { website, source } or null.
 */
async function findWebsite(lead, { search = null, location = '' } = {}) {
  const profiles = (lead.platforms || []).map((p) => p?.profileUrl).filter(Boolean)
    .concat((lead.sources || []).filter((u) => /instagram|facebook|tiktok|linktr|beacons/i.test(String(u))));
  for (const url of [...new Set(profiles)].slice(0, 3)) {
    const site = await fromProfile(url);
    if (site) return { website: site, source: url };
  }
  if (search && lead.name) {
    try {
      const results = await search(`"${lead.name}" ${lead.location || location} official website`);
      const hit = (results || []).find((r) => isOwnSiteCandidate(r.url) && matchesName(r.url, lead.name));
      if (hit) return { website: `https://${host(hit.url)}`, source: hit.url };
    } catch { /* search failed - no website found */ }
  }
  return null;
}

module.exports = { findWebsite, linksInProfile, isOwnSiteCandidate, matchesName, fromProfile };
