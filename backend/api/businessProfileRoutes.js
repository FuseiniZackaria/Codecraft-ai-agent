const express = require('express');
const memory = require('../memory');
const businessProfile = require('../core/businessProfile');
const { validateProfile } = require('../core/businessProfileRules');

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

// Required fields, optional fields and their formats: core/businessProfileRules.js.

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
    // Required fields must be filled in; optional ones may be empty but, if
    // filled in, must look right. fieldErrors lets the form point at each field.
    const { patch, fieldErrors, errors } = validateProfile(req.body || {});
    if (errors.length) {
      return res.status(400).json({ error: 'Please fix the highlighted fields.', details: errors, fieldErrors });
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
