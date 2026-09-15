const composio = require('../../../core/composio');

// Confirmed working via live testing against a real Composio account
// (2026-08-25). If this ever starts erroring after a Composio API change,
// the error message will usually name the correct replacement slug.
const ACTION_SLUG = 'GOOGLECALENDAR_FIND_EVENT';

module.exports = {
  name: 'listEvents',
  permission: 'googlecalendar.read',
  irreversible: false,

  /**
   * @param {object} args
   * @param {string} args.timeMin - ISO datetime, start of range to check
   * @param {string} args.timeMax - ISO datetime, end of range to check
   * @param {string} [args.calendarId] - defaults to 'primary'
   */
  async run({ timeMin, timeMax, calendarId = 'primary' } = {}) {
    if (!timeMin || !timeMax) {
      throw new Error('listEvents requires "timeMin" and "timeMax"');
    }

    const result = await composio.execute(ACTION_SLUG, {
      calendar_id: calendarId,
      time_min: timeMin,
      time_max: timeMax,
      single_events: true,
    }, 'googlecalendar');

    // Normalize whatever shape Composio returns into a flat busy-periods
    // list - the one thing core/scheduling/availability.js actually needs.
    // Confirmed via live testing against a real Composio account (2026-08-25):
    // events actually come back nested under result.event_data.event_data,
    // NOT top-level "items" or "events" as originally guessed. Keeping
    // those as a fallback in case the shape differs across API versions.
    const rawEvents = result?.event_data?.event_data || result?.items || result?.events || [];
    const busyPeriods = rawEvents
      .map((e) => ({
        start: e.start?.dateTime || e.start?.date || e.start,
        end: e.end?.dateTime || e.end?.date || e.end,
        summary: e.summary || e.title || null,
      }))
      .filter((e) => e.start && e.end);

    return { busyPeriods, raw: result };
  },
};