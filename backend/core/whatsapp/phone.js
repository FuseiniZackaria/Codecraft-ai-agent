const config = require('../../config');

/**
 * WhatsApp numbers are stored and sent as digits only: country code first, no
 * "+", no leading zero (e.g. "233241234567").
 *
 *   "+233 24 123 4567"      -> "233241234567"
 *   "0024 1234 5678"        -> "2412345678"     (00 = international prefix)
 *   "024 123 4567"          -> "233241234567"   (local, default country code added)
 *   "whatsapp:+23324..."    -> "23324..."       (Twilio address)
 *   "23324...@c.us"         -> "23324..."       (WAHA chat id)
 *
 * Returns null for anything that can't be a phone number.
 */
function normalizeNumber(input, defaultCountryCode = config.whatsapp.defaultCountryCode) {
  const raw = String(input || '').trim()
    .replace(/^whatsapp:/i, '')
    .replace(/@(c\.us|s\.whatsapp\.net)$/i, '');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (raw.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = `${defaultCountryCode}${digits.slice(1)}`;
  } else if (digits.length <= 9) {
    // a local number written without its leading zero
    digits = `${defaultCountryCode}${digits}`;
  }

  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** WAHA chat id for a person: "<digits>@c.us". */
function toChatId(number) {
  const digits = normalizeNumber(number);
  if (!digits) throw new Error(`Not a valid WhatsApp number: "${number}"`);
  return `${digits}@c.us`;
}

module.exports = { normalizeNumber, toChatId };
