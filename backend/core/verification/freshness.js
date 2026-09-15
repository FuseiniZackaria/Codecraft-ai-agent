/**
 * freshness.js - deterministic job-posting freshness classification.
 *
 * Pure function, no network or LLM calls involved - so it's cheap, instant,
 * and fully unit-testable on its own. Per the spec: an undated listing must
 * never be silently assumed current, so POSTING_DATE_UNKNOWN is a distinct
 * status, not folded into "stale" or "fresh".
 */

const DEFAULT_RULES = {
  strongPreferenceDays: 14, // "strong preference" window
  preferredDays: 30, // default "prefer within" window
};

function daysAgo(dateStr, now = new Date()) {
  const posted = new Date(dateStr);
  if (isNaN(posted.getTime())) return null;
  const ms = now.getTime() - posted.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * @param {string|null|undefined} postedDate - ISO date string or anything Date() can parse
 * @param {object} [rules] - override default day thresholds
 * @param {Date} [now] - injectable for tests
 * @returns {{ status: string, daysOld: number|null, label: string }}
 */
function checkFreshness(postedDate, rules = {}, now = new Date()) {
  const { strongPreferenceDays, preferredDays } = { ...DEFAULT_RULES, ...rules };

  if (!postedDate) {
    return { status: 'POSTING_DATE_UNKNOWN', daysOld: null, label: 'Posting date unknown - do not assume current' };
  }

  const days = daysAgo(postedDate, now);
  if (days === null) {
    return { status: 'POSTING_DATE_UNKNOWN', daysOld: null, label: 'Posting date unparseable - do not assume current' };
  }

  if (days < 0) {
    return { status: 'POSTING_DATE_UNKNOWN', daysOld: days, label: 'Posting date is in the future - suspicious, flag for review' };
  }

  if (days <= strongPreferenceDays) {
    return { status: 'FRESH', daysOld: days, label: `Posted ${days} day(s) ago - within strong preference window` };
  }

  if (days <= preferredDays) {
    return { status: 'ACCEPTABLE', daysOld: days, label: `Posted ${days} day(s) ago - within default preference window` };
  }

  return { status: 'STALE', daysOld: days, label: `Posted ${days} day(s) ago - older than ${preferredDays} days, flagged` };
}

module.exports = { checkFreshness, daysAgo, DEFAULT_RULES };