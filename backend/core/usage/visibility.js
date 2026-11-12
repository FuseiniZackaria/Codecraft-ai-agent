/**
 * Who may see what about OTHER people. Only the owner sees other admins:
 * their emails, team changes, usage and caps. Everyone else sees only
 * their own entries.
 *
 * Applied to the audit log at the source (memory.getAuditLog), so the
 * Console, the dashboard, analytics and Ian's "console logs" tool all get
 * the same filtered view, and to the live event stream.
 */

const ctx = require('./context');

// Team, account and usage events: owner only.
const OWNER_ONLY = /^(admin_|account_|invite_|team_|role_|usage_cap)/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Can `viewer` ({ role, email }) see this audit entry / live event? */
function canSee(entry, viewer) {
  if (!viewer || viewer.role === 'owner') return true;
  const action = String(entry?.action || '');
  if (OWNER_ONLY.test(action)) return false;
  // An entry made by another person (their email as the actor) stays theirs.
  const actor = String(entry?.actor || entry?.agent || '').trim().toLowerCase();
  if (EMAIL.test(actor) && actor !== String(viewer.email || '').toLowerCase()) return false;
  return true;
}

/**
 * Filter for whoever is asking right now (the request's user). Background
 * work with no user (scheduler, webhooks) is not a viewer and gets everything.
 */
function filterForCurrentViewer(entries) {
  const c = ctx.current();
  if (c.automated || !c.userId) return entries;
  return (entries || []).filter((e) => canSee(e, { role: c.role, email: c.email }));
}

// Fields that name a PERSON of this app (never a lead's or contact's email).
const PERSON_EMAIL_KEYS = new Set(['user_email', 'created_by_email', 'createdByEmail', 'owner_email', 'ownerEmail', 'updated_by_email', 'linked.by']);
const PERSON_ID_KEYS = new Set(['user_id', 'created_by', 'updated_by', 'owner_user_id', 'connected_by']);

/**
 * A copy of `body` with OTHER people's ids and emails blanked (null), for a
 * non-owner viewer. The viewer's own id/email stay. Plain objects and arrays only.
 */
function redactOthers(body, viewer, depth = 0) {
  if (!viewer || viewer.role === 'owner' || body === null || typeof body !== 'object' || depth > 12) return body;
  if (Array.isArray(body)) return body.map((v) => redactOthers(v, viewer, depth + 1));
  const proto = Object.getPrototypeOf(body);
  if (proto !== Object.prototype && proto !== null) return body; // Dates, Buffers...
  const myEmail = String(viewer.email || '').toLowerCase();
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (PERSON_EMAIL_KEYS.has(k) && typeof v === 'string' && v && v.toLowerCase() !== myEmail) out[k] = null;
    else if (PERSON_ID_KEYS.has(k) && typeof v === 'string' && v && v !== viewer.id) out[k] = null;
    else out[k] = redactOthers(v, viewer, depth + 1);
  }
  return out;
}

/** Express middleware: every JSON response to a non-owner goes through redactOthers. */
function hideOtherPeople(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(req.user && req.user.role !== 'owner' && !isAppOwnerEmail(req.user) ? redactOthers(body, req.user) : body);
  next();
}

// The APP_OWNER_EMAIL account already sees every client (Clients page) - keep that
// working before migration 0013b gives it the owner role.
function isAppOwnerEmail(user) {
  const ownerEmail = String(process.env.APP_OWNER_EMAIL || require('../../config').applicant?.email || '').trim().toLowerCase();
  return !!ownerEmail && String(user?.email || '').toLowerCase() === ownerEmail;
}

module.exports = { canSee, filterForCurrentViewer, redactOthers, hideOtherPeople, OWNER_ONLY };
