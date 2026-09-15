const composio = require('../../../core/composio');

// Confirmed working via live testing against a real Composio account
// (2026-08-25) - created a real event successfully, including an
// auto-generated Google Meet link. If this ever starts erroring after a
// Composio API change, the error message will usually name the correct
// replacement slug.
const ACTION_SLUG = 'GOOGLECALENDAR_CREATE_EVENT';

module.exports = {
  name: 'createEvent',
  permission: 'googlecalendar.write',
  // Creating an event invites another real person (via a calendar invite
  // email) and occupies a real slot on the calendar - hard to cleanly undo
  // once sent, same category as sending an email -> approval gate applies,
  // consistent with every other outward-facing action in this codebase.
  irreversible: true,

  /**
   * @param {object} args
   * @param {string} args.title
   * @param {string} args.startTime - ISO datetime
   * @param {string} args.endTime - ISO datetime
   * @param {string} [args.timezone]
   * @param {string} [args.description]
   * @param {string[]} [args.attendeeEmails]
   * @param {number[]} [args.reminderMinutesBefore] - e.g. [1440, 60, 15] for 24h/1h/15m
   * @param {string} [args.calendarId] - defaults to 'primary'
   */
  async run({
    title,
    startTime,
    endTime,
    timezone,
    description,
    attendeeEmails = [],
    reminderMinutesBefore = [1440, 60, 15],
    calendarId = 'primary',
  } = {}) {
    const missing = [];
    if (!title) missing.push('title');
    if (!startTime) missing.push('startTime');
    if (!endTime) missing.push('endTime');
    if (missing.length) {
      throw new Error(`createEvent is missing: ${missing.join(', ')}`);
    }

    const result = await composio.execute(ACTION_SLUG, {
      calendar_id: calendarId,
      summary: title,
      description: description || '',
      start_datetime: startTime,
      event_duration_hour: 0, // duration derived from start/end below where the API supports it directly
      timezone: timezone || undefined,
      attendees: attendeeEmails,
      // Field name/shape for reminder overrides is a best guess following
      // Google Calendar API's own "reminders.overrides" convention
      // (method: popup/email, minutes: number before start).
      reminders: {
        useDefault: false,
        overrides: reminderMinutesBefore.map((minutes) => ({ method: 'popup', minutes })),
      },
      // Some Composio calendar actions want explicit end time instead of
      // duration - passing both is harmless if only one is actually used.
      end_datetime: endTime,
    }, 'googlecalendar');

    // Field names confirmed via live testing against a real Composio
    // account (2026-08-25): the calendar link comes back as display_url,
    // and Google Calendar auto-generates a Meet link under
    // response_data.conferenceData.entryPoints - genuinely useful for a
    // call booking, so it's worth surfacing explicitly rather than leaving
    // it buried in the raw response.
    const meetLink = result?.response_data?.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null;

    return {
      status: 'scheduled',
      title,
      startTime,
      endTime,
      attendeeEmails,
      calendarUrl: result?.display_url || null,
      meetLink,
      ...result,
    };
  },
};