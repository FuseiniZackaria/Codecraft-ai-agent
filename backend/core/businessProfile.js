/**
 * businessProfile.js — Phase 2.4 per-workspace business profile.
 *
 * Reads from the business_profile Supabase table (one row per workspace),
 * caches the row for 5 minutes to spare the DB on every chat turn, and
 * falls back to legacy single-tenant env/business.json defaults when the
 * row is empty or missing. That fallback is what keeps every existing
 * agent working without a mandatory per-workspace fill-in step.
 *
 * The service is deliberately read-centric: writes go through the normal
 * memory.updateBusinessProfile path (workspaceGuard watches it), and that
 * same path invalidates the cache so the Settings form sees a fresh read
 * on save.
 */

const memory = require('../memory');
const config = require('../config');

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // workspaceId -> { profile, at }

function putCache(workspaceId, profile) {
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(workspaceId, { profile, at: Date.now() });
}

function readCache(workspaceId) {
  const e = cache.get(workspaceId);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cache.delete(workspaceId);
    return null;
  }
  return e.profile;
}

function invalidate(workspaceId) {
  if (!workspaceId) cache.clear();
  else cache.delete(workspaceId);
}

/**
 * Returns the fully-resolved profile for one workspace. Fields the DB
 * row left blank are filled from the legacy env/business.json config so
 * every downstream caller can read a single shape regardless of whether
 * the owner has filled the Settings page yet.
 */
async function getProfile(workspaceId) {
  if (!workspaceId) return legacyFallback();

  const hit = readCache(workspaceId);
  if (hit) return hit;

  let row = null;
  try {
    row = await memory.getBusinessProfile({ workspaceId });
  } catch (err) {
    // A storage failure must not break every prompt in the app. Log once
    // and degrade to legacy defaults so chat/outreach keeps working.
    console.warn(`[businessProfile] read failed for workspace ${workspaceId}: ${err.message}`);
  }

  const legacy = legacyFallback();
  const resolved = {
    workspace_id: workspaceId,
    display_name:         valueOf(row?.display_name,   legacy.display_name),
    business_name:        valueOf(row?.business_name,  legacy.business_name),
    title:                valueOf(row?.title,          legacy.title),
    business_email:       valueOf(row?.business_email, legacy.business_email),
    extra_email_addresses: Array.isArray(row?.extra_email_addresses)
      ? row.extra_email_addresses.filter(Boolean)
      : legacy.extra_email_addresses,
    phone:                valueOf(row?.phone,          legacy.phone),
    whatsapp:             valueOf(row?.whatsapp,       legacy.whatsapp),
    website:              valueOf(row?.website,        legacy.website),
    location:             valueOf(row?.location,       legacy.location),
    offers:               valueOf(row?.offers,         legacy.offers),
    signature:            valueOf(row?.signature,      legacy.signature),
    tone:                 valueOf(row?.tone,           legacy.tone),
    logo_url:             valueOf(row?.logo_url,       null),
  };

  putCache(workspaceId, resolved);
  return resolved;
}

function valueOf(primary, fallback) {
  if (primary === undefined || primary === null) return fallback || null;
  if (typeof primary === 'string' && primary.trim() === '') return fallback || null;
  return primary;
}

/**
 * Single-tenant fallback. Reads what used to be the only source of
 * business context (env + backend/config/business.json). This path is
 * also what the legacy single-admin deployment keeps using when its
 * business_profile row is still blank.
 */
function legacyFallback() {
  const b = config.business || {};
  const a = config.applicant || {};
  return {
    workspace_id: null,
    display_name:         a.fullName || null,
    business_name:        b.companyName || null,
    title:                null,
    business_email:       a.email || null,
    extra_email_addresses: (config.myEmailAddresses || []).map((s) => s.toLowerCase()),
    phone:                a.phone || null,
    whatsapp:             null,
    website:              a.portfolioUrl || b.website || null,
    location:             a.location || b.location || null,
    offers:               b.services || null,
    signature:            null,
    tone:                 null,
    logo_url:             null,
  };
}

/**
 * Prompt-ready block of text (same shape businessContextLine used to
 * produce) for the workspace. Returns '' when nothing is filled in -
 * matches the pre-Phase-2.4 behaviour, so a brand-new install still
 * works with zero config.
 */
async function profileContextLine(workspaceId) {
  const p = await getProfile(workspaceId);
  const legacyFaq = (config.business?.faq || []).filter((f) => f.question && f.answer);

  const parts = [];
  if (p.business_name) parts.push(`Business: ${p.business_name}`);
  if (p.display_name)  parts.push(`Owner: ${p.display_name}${p.title ? ` (${p.title})` : ''}`);
  if (p.offers)        parts.push(`Offers: ${p.offers}`);
  if (p.location)      parts.push(`Location: ${p.location}`);
  if (p.website)       parts.push(`Website: ${p.website}`);
  if (p.phone)         parts.push(`Phone: ${p.phone}`);
  if (p.whatsapp)      parts.push(`WhatsApp: ${p.whatsapp}`);
  if (p.business_email) parts.push(`Email: ${p.business_email}`);
  if (p.tone)          parts.push(`Tone: ${p.tone}`);
  if (p.signature)     parts.push(`Signature:\n${p.signature}`);

  // Legacy business.json still carries a few richer fields the Settings
  // page doesn't surface yet (industry, pricing, policies, FAQ). Keep
  // feeding those into the prompt so an existing deployment doesn't lose
  // knowledge just because the per-workspace row is still blank.
  const b = config.business || {};
  if (b.industry)      parts.push(`Industry: ${b.industry}`);
  if (b.targetMarket)  parts.push(`Target market: ${b.targetMarket}`);
  if (b.description && !p.offers) parts.push(`Description: ${b.description}`);
  if (b.knownCompetitors?.length) parts.push(`Known competitors: ${b.knownCompetitors.join(', ')}`);
  if (b.hours)         parts.push(`Hours: ${b.hours}`);
  if (b.pricing)       parts.push(`Pricing: ${b.pricing}`);
  if (b.policies)      parts.push(`Policies: ${b.policies}`);
  if (legacyFaq.length) {
    parts.push(`FAQ:\n${legacyFaq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n')}`);
  }

  return parts.length
    ? `Business knowledge (only use what's stated here - never guess beyond it):\n${parts.join('\n')}\n\n`
    : '';
}

async function hasKnowledge(workspaceId) {
  const p = await getProfile(workspaceId);
  if (p.offers || p.signature || p.location || p.website || p.phone || p.whatsapp) return true;
  const b = config.business || {};
  if (b.description || b.pricing || b.policies || b.hours) return true;
  return !!(b.faq || []).some((f) => f.question && f.answer);
}

/** Every address the inbox-triage filter should treat as "me". */
async function selfEmailSet(workspaceId) {
  const p = await getProfile(workspaceId);
  const set = new Set();
  if (p.business_email) set.add(p.business_email.toLowerCase());
  for (const e of p.extra_email_addresses || []) {
    if (typeof e === 'string' && e.trim()) set.add(e.trim().toLowerCase());
  }
  return set;
}

/**
 * Owner-notification target. The Gmail guard refuses systemDigest sends
 * to anything other than this one address, so returning the right email
 * per workspace is what unlocks per-workspace owner notifications.
 */
async function ownerEmail(workspaceId) {
  const p = await getProfile(workspaceId);
  return p.business_email || null;
}

module.exports = {
  getProfile,
  profileContextLine,
  hasKnowledge,
  selfEmailSet,
  ownerEmail,
  invalidate,
};
