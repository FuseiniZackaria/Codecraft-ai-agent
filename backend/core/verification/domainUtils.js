/**
 * domainUtils.js - small deterministic helpers for comparing domains across
 * a company website, an application URL, and a contact email. No network
 * calls involved - pure string parsing, cheap and fully unit-testable.
 */

function extractDomainFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function extractDomainFromEmail(email) {
  if (!email) return null;
  const match = String(email).match(/@([\w.-]+)$/);
  return match ? match[1].replace(/^www\./, '').toLowerCase() : null;
}

function isValidEmailFormat(email) {
  return !!email && /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(String(email));
}

function domainsMatch(a, b) {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

module.exports = { extractDomainFromUrl, extractDomainFromEmail, isValidEmailFormat, domainsMatch };