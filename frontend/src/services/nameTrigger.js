/**
 * Name-trigger matcher for the floating Assistant.
 *
 * The user picked "must appear at the start of the message" in the design
 * step, so this only matches the start - optionally preceded by a greeting
 * ("hi", "hey", "hello", "yo", "ok"), optionally followed by a comma/colon.
 *
 * Case-insensitive. Variations are checked after escaping so a value with
 * regex metacharacters can't blow up the matcher.
 */

const GREETINGS = ['hi', 'hey', 'hello', 'yo', 'ok', 'okay', 'hiya'];

function escape(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPattern(variations) {
  const names = variations.map(escape).join('|');
  const greet = GREETINGS.join('|');
  // Optional greeting + space(s), then the name, then optional comma/colon.
  // Captures what's after the trigger as group 1.
  return new RegExp(
    `^\\s*(?:(?:${greet})[\\s,]+)?(?:${names})[\\s,:.!-]*(.*)$`,
    'is', // dotAll so a captured newline survives; case-insensitive
  );
}

/**
 * @param {string} message
 * @param {string[]} variations - e.g. ["Ian", "Ean", "Ion"]
 * @returns {{matched: boolean, stripped: string}}
 */
export function matchNameTrigger(message, variations) {
  if (!message || !variations?.length) return { matched: false, stripped: message || '' };
  const pattern = buildPattern(variations);
  const m = pattern.exec(message);
  if (!m) return { matched: false, stripped: message };
  const stripped = (m[1] || '').trim();
  return { matched: true, stripped };
}
