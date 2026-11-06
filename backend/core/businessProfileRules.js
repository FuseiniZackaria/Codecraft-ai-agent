/**
 * What each Business Profile field accepts. Used by PATCH /api/business-profile;
 * the Settings page shows the same rules (frontend/src/components/settings/profileRules.js).
 *
 *   required  must be filled in when it's sent (a partial update that leaves it
 *             out keeps the saved value)
 *   optional  may be left empty; if filled in, it must look right (a real email,
 *             phone number, website...)
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-().]+$/;
const WEBSITE_RE = /^(https?:\/\/)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;

const FIELD_RULES = {
  business_name: { label: 'Business name', required: true, max: 120 },
  display_name: { label: 'Your name', required: true, max: 80 },
  title: { label: 'Your title', max: 80 },
  business_email: { label: 'Business email', max: 254, type: 'email' },
  phone: { label: 'Phone number', max: 30, type: 'phone' },
  whatsapp: { label: 'WhatsApp number', max: 30, type: 'phone' },
  website: { label: 'Website', max: 300, type: 'website' },
  location: { label: 'Location', max: 120 },
  offers: { label: 'What you offer', max: 2000 },
  signature: { label: 'Email signature', max: 2000 },
  tone: { label: 'Tone', max: 2000 },
  logo_url: { label: 'Logo link', max: 500, type: 'website' },
};
const MAX_EXTRA_EMAILS = 20;

/** One field's problem, or null. value is a trimmed string ('' = empty). */
function fieldError(key, value) {
  const rule = FIELD_RULES[key];
  if (!rule) return null;
  if (!value) return rule.required ? `${rule.label} is required.` : null;
  if (value.length > rule.max) return `${rule.label} is too long (max ${rule.max} characters).`;
  if (rule.type === 'email' && !EMAIL_RE.test(value)) return `${rule.label} doesn't look like an email address (e.g. hello@yourbusiness.com).`;
  if (rule.type === 'phone') {
    const digits = value.replace(/\D/g, '').length;
    if (!PHONE_RE.test(value) || digits < 7 || digits > 15) return `${rule.label} doesn't look like a phone number (e.g. +233 20 123 4567).`;
  }
  if (rule.type === 'website' && !WEBSITE_RE.test(value)) return `${rule.label} doesn't look like a web address (e.g. yourbusiness.com).`;
  return null;
}

/**
 * Check a PATCH body. Returns { patch, fieldErrors, errors }: patch holds the
 * cleaned values to save ('' -> null); fieldErrors maps a field to its message.
 */
function validateProfile(body = {}) {
  const patch = {};
  const fieldErrors = {};

  for (const key of Object.keys(FIELD_RULES)) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw !== null && raw !== undefined && typeof raw !== 'string') {
      fieldErrors[key] = `${FIELD_RULES[key].label} must be text.`;
      continue;
    }
    const value = String(raw ?? '').trim();
    const problem = fieldError(key, value);
    if (problem) fieldErrors[key] = problem;
    else patch[key] = value || null;
  }

  if ('extra_email_addresses' in body) {
    const list = body.extra_email_addresses;
    if (!Array.isArray(list)) fieldErrors.extra_email_addresses = 'Other email addresses must be a list.';
    else if (list.length > MAX_EXTRA_EMAILS) fieldErrors.extra_email_addresses = `You can add up to ${MAX_EXTRA_EMAILS} other email addresses.`;
    else {
      const cleaned = [];
      for (const item of list) {
        const email = String(item ?? '').trim().toLowerCase();
        if (!email) continue;
        if (typeof item !== 'string' || !EMAIL_RE.test(email)) {
          fieldErrors.extra_email_addresses = `"${email}" doesn't look like an email address.`;
          break;
        }
        if (!cleaned.includes(email)) cleaned.push(email);
      }
      if (!fieldErrors.extra_email_addresses) patch.extra_email_addresses = cleaned;
    }
  }

  return { patch, fieldErrors, errors: Object.values(fieldErrors) };
}

module.exports = { validateProfile, fieldError, FIELD_RULES, ALLOWED_FIELDS: [...Object.keys(FIELD_RULES), 'extra_email_addresses'] };
