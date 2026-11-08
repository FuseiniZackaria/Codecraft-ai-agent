const dns = require('dns').promises;

/**
 * Can this address receive email at all? A DNS check on its domain (free, no
 * email is sent): the domain must exist and accept mail (an MX record, or at
 * least an address record). Catches dead and misspelled domains before a
 * send - "info@wagcol.com" style typos, expired business sites.
 *
 * It can't tell whether one mailbox exists on a working domain (mail servers
 * don't reliably say) - those bounce, and core/emailBounces.js catches them.
 *
 * A DNS problem on our side (timeout, no network) never blocks a send.
 */

const CACHE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const cache = new Map(); // domain -> { at, result }

const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), TIMEOUT_MS))]);
const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

async function checkDomain(domain) {
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    // A "null MX" (RFC 7505: priority 0, exchange ".") means "this domain takes no email".
    if (mx.length && mx.every((r) => !r.exchange || r.exchange === '.')) return { ok: false, reason: `${domain} doesn't accept email` };
    if (mx.length) return { ok: true };
  } catch (err) {
    if (!NOT_FOUND.has(err.code)) return { ok: true, unchecked: true }; // our DNS trouble - don't block
  }
  // No MX: mail falls back to the domain's own address (rare, but valid).
  try {
    const a = await withTimeout(dns.resolve(domain));
    if (a.length) return { ok: true };
  } catch (err) {
    if (!NOT_FOUND.has(err.code)) return { ok: true, unchecked: true };
  }
  return { ok: false, reason: `the domain ${domain} doesn't exist or can't receive email` };
}

/** { ok, reason? } for one address. Never throws. */
async function canReceiveEmail(email) {
  if (process.env.CC_TESTING === '1' && !process.env.CC_EMAIL_DNS_CHECK) return { ok: true, unchecked: true };
  const domain = String(email || '').split('@')[1]?.trim().toLowerCase();
  if (!domain) return { ok: false, reason: 'not an email address' };
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  const result = await checkDomain(domain).catch(() => ({ ok: true, unchecked: true }));
  if (!result.unchecked) cache.set(domain, { at: Date.now(), result });
  return result;
}

module.exports = { canReceiveEmail, _clearCache: () => cache.clear() };
