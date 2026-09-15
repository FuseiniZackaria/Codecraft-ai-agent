/**
 * check-calendar-create.js - one-off diagnostic script for createEvent.
 *
 * Creates ONE clearly-labeled test event on your REAL connected Google
 * Calendar, so you can confirm whether the Composio tool slug guess
 * (GOOGLECALENDAR_CREATE_EVENT) is actually correct - and see the real
 * response shape, the way check-calendar.js already confirmed listEvents.
 *
 * Safety choices made on purpose:
 *   - Title is prefixed "[TEST]" and scheduled tomorrow at 3:00-3:30pm
 *     (server local time), so it's easy to find and delete afterward.
 *   - No attendeeEmails are passed - nobody receives a real invite email
 *     from this test.
 *   - Only ever creates ONE event per run.
 *
 * Run from the backend/ folder:
 *   node check-calendar-create.js
 *
 * After running: go check your Google Calendar for tomorrow, confirm the
 * "[TEST] CodeCraft Calendar Integration Test" event actually shows up
 * with the reminders set, then delete it manually - this script doesn't
 * clean up after itself on purpose (a delete-your-own-event step should be
 * an equally deliberate, visible action, not another automated one).
 */

const { loadPlugins } = require('./core/pluginLoader');
const toolRegistry = require('./tools/ToolRegistry');

async function main() {
  loadPlugins();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(15, 0, 0, 0);
  const start = new Date(tomorrow);
  const end = new Date(tomorrow.getTime() + 30 * 60 * 1000);

  console.log(`Creating a test event: ${start.toString()} to ${end.toString()}\n`);

  try {
    const result = await toolRegistry.call(
      'googlecalendar.createEvent',
      {
        title: '[TEST] CodeCraft Calendar Integration Test',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        description: 'This is a one-off test event created by check-calendar-create.js to confirm the Composio createEvent integration works. Safe to delete.',
        attendeeEmails: [], // deliberately empty - no real invite emails sent
        reminderMinutesBefore: [60, 15],
      },
      { role: 'diagnostic-script' }
    );

    console.log('✓ Success. The tool call completed without error.\n');
    console.log('Result:');
    console.log(JSON.stringify(result, null, 2).slice(0, 1500));
    console.log('\nNow go check your Google Calendar for tomorrow at 3:00pm - confirm the event is actually there with reminders set, then delete it manually.');
  } catch (err) {
    console.error('✗ googlecalendar.createEvent failed:\n');
    console.error(err.message);

    if (err.message.includes('COMPOSIO_API_KEY') || err.message.includes('not configured')) {
      console.error('\nThis is a configuration issue - set COMPOSIO_API_KEY in your .env first, then re-run this script.');
    } else if (err.message.includes('No active') || err.message.includes('connection')) {
      console.error('\nThis means COMPOSIO_API_KEY is set, but no Google Calendar account is connected yet - go connect one in the Composio dashboard, then re-run this script.');
    } else {
      console.error('\nThis usually means the ACTION_SLUG guess, or one of the field names in the request, is wrong.');
      console.error('Check the error above for details - Composio often names the correct slug or the specific invalid field.');
      console.error('The file to fix is plugins/googlecalendar/actions/createEvent.js.');
    }
  }
}

main();