// Business Profile form rules - the same as the server's
// (backend/core/businessProfileRules.js). Required fields must be filled in;
// optional ones may be left empty, but if filled in they must look right.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-().]+$/;
const WEBSITE_RE = /^(https?:\/\/)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;

export const PROFILE_RULES = {
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
};

export const isEmail = (v) => EMAIL_RE.test(String(v || '').trim());

/** The problem with one field, or null. */
export function fieldError(key, raw) {
  const rule = PROFILE_RULES[key];
  if (!rule) return null;
  const value = String(raw ?? '').trim();
  if (!value) return rule.required ? `${rule.label} is required.` : null;
  if (value.length > rule.max) return `${rule.label} is too long (max ${rule.max} characters).`;
  if (rule.type === 'email' && !EMAIL_RE.test(value)) return "This doesn't look like an email address (e.g. hello@yourbusiness.com).";
  if (rule.type === 'phone') {
    const digits = value.replace(/\D/g, '').length;
    if (!PHONE_RE.test(value) || digits < 7 || digits > 15) return "This doesn't look like a phone number (e.g. +233 20 123 4567).";
  }
  if (rule.type === 'website' && !WEBSITE_RE.test(value)) return "This doesn't look like a web address (e.g. yourbusiness.com).";
  return null;
}

/** { field: message } for every field with a problem. */
export function validateProfileForm(form) {
  const errors = {};
  for (const key of Object.keys(PROFILE_RULES)) {
    const problem = fieldError(key, form[key]);
    if (problem) errors[key] = problem;
  }
  return errors;
}
