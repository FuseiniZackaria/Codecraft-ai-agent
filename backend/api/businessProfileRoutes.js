const express = require('express');
const memory = require('../memory');
const businessProfile = require('../core/businessProfile');

const router = express.Router();

/**
 * GET /api/business-profile
 *
 * Returns the resolved profile for the caller's workspace — the raw row
 * values where present, with legacy env defaults filled in otherwise.
 * Having one shape for both cases means the Settings page can render
 * current values without caring whether the row was ever saved.
 */
router.get('/', async (req, res) => {
  try {
    const workspaceId = req.user?.workspaceId || null;
    if (!workspaceId) {
      // Legacy single-tenant deployment that hasn't run migration 0001:
      // return legacy defaults so the Settings page is still editable.
      const profile = await businessProfile.getProfile(null);
      return res.json({ profile, workspaceId: null, legacy: true });
    }
    const profile = await businessProfile.getProfile(workspaceId);
    res.json({ profile, workspaceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const ALLOWED_FIELDS = [
  'display_name', 'business_name', 'title', 'business_email',
  'extra_email_addresses', 'phone', 'whatsapp', 'website', 'location',
  'offers', 'signature', 'tone', 'logo_url',
];

const MAX_STRING_LEN = 2000;
const MAX_EXTRA_EMAILS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * PATCH /api/business-profile
 *
 * Partial update. Only the fields listed in the body are touched - every
 * other field keeps its current value. Validates per-field so a bad entry
 * in one slot never silently writes an unrelated one.
 */
router.patch('/', async (req, res) => {
  try {
    const workspaceId = req.user?.workspaceId || null;
    if (!workspaceId) {
      return res.status(400).json({
        error:
          'This deployment has no workspace yet — run migration 0001 so your admin owns a workspace.',
      });
    }
    const body = req.body || {};
    const patch = {};
    const errors = [];

    for (const key of ALLOWED_FIELDS) {
      if (!(key in body)) continue;
      const value = body[key];

      if (key === 'extra_email_addresses') {
        if (!Array.isArray(value)) {
          errors.push('extra_email_addresses must be an array of strings');
          continue;
        }
        if (value.length > MAX_EXTRA_EMAILS) {
          errors.push(`extra_email_addresses: max ${MAX_EXTRA_EMAILS} entries`);
          continue;
        }
        const cleaned = [];
        for (const raw of value) {
          if (typeof raw !== 'string') { errors.push('extra_email_addresses: entries must be strings'); continue; }
          const trimmed = raw.trim().toLowerCase();
          if (!trimmed) continue;
          if (!EMAIL_RE.test(trimmed)) {
            errors.push(`extra_email_addresses: "${trimmed}" is not a valid email`);
            continue;
          }
          if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
        }
        patch.extra_email_addresses = cleaned;
        continue;
      }

      if (value === null || value === '') {
        patch[key] = null;
        continue;
      }
      if (typeof value !== 'string') {
        errors.push(`${key} must be a string or null`);
        continue;
      }
      if (value.length > MAX_STRING_LEN) {
        errors.push(`${key}: max ${MAX_STRING_LEN} characters`);
        continue;
      }
      if (key === 'business_email' && !EMAIL_RE.test(value.trim())) {
        errors.push('business_email is not a valid email');
        continue;
      }
      patch[key] = value.trim();
    }

    if (errors.length) {
      return res.status(400).json({ error: 'Invalid input', details: errors });
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const saved = await memory.updateBusinessProfile(patch, { workspaceId });
    // Drop the per-workspace cache so the next read sees the new row.
    businessProfile.invalidate(workspaceId);
    const resolved = await businessProfile.getProfile(workspaceId);
    res.json({ saved, profile: resolved, workspaceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
