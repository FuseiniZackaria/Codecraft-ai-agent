/**
 * Website links for the video editor: public http(s) sites only. Never
 * localhost, the local network, or cloud metadata addresses - a client's link
 * must not make the worker (your laptop) open your router or other machines.
 * The worker checks again after DNS (worker/lib/safeBrowser.js).
 */

const PRIVATE_HOST = /^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[?::1\]?$|\[?f[cde][0-9a-f]{2}:|metadata\.google|.*\.local$|.*\.internal$)/i;

/** A clean public URL string, or null. */
function publicHttpUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (u.username || u.password) return null; // no "user:pass@host" links
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || PRIVATE_HOST.test(host)) return null;
  u.hash = '';
  return u.toString();
}

module.exports = { publicHttpUrl, PRIVATE_HOST };
