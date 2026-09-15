/**
 * check-calendar.js - one-off diagnostic script.
 *
 * Calls googlecalendar.listEvents for the next 7 days against your REAL
 * connected Google Calendar account, so you can confirm whether the
 * Composio tool slug guess (GOOGLECALENDAR_FIND_EVENT) is actually correct.
 *
 * Run from the backend/ folder:
 *   node check-calendar.js
 *
 * What to expect:
 *   - If it prints a list of events (or "0 events found" with no error),
 *     the slug is correct - Phase 4 is good to go as-is.
 *   - If it throws an error, read the error message carefully - Composio
 *     usually names the correct tool slug directly in the error, or lists
 *     available tools for the toolkit. Once you have the right slug, open
 *     plugins/googlecalendar/actions/listEvents.js and update the
 *     ACTION_SLUG constant at the top of the file to match.
 */

const { loadPlugins } = require('./core/pluginLoader');
const toolRegistry = require('./tools/ToolRegistry');

async function main() {
  loadPlugins();

  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  console.log(`Checking calendar from ${now.toISOString()} to ${weekOut.toISOString()}...\n`);

  try {
    const result = await toolRegistry.call(
      'googlecalendar.listEvents',
      { timeMin: now.toISOString(), timeMax: weekOut.toISOString() },
      { role: 'diagnostic-script' }
    );

    console.log(`✓ Success. Found ${result.busyPeriods.length} busy period(s) in the next 7 days.\n`);
    if (result.busyPeriods.length > 0) {
      console.log('Busy periods:');
      result.busyPeriods.forEach((b) => console.log(`  - ${b.summary || '(no title)'}: ${b.start} to ${b.end}`));
    } else {
      console.log('(Calendar is clear for the next 7 days, or the account has no events in range - either way, the tool call itself worked.)');
    }

    console.log('\nRaw Composio response (first 1000 chars), useful if the busyPeriods mapping above looks wrong:');
    console.log(JSON.stringify(result.raw, null, 2).slice(0, 1000));
  } catch (err) {
    console.error('✗ googlecalendar.listEvents failed:\n');
    console.error(err.message);

    if (err.message.includes('COMPOSIO_API_KEY') || err.message.includes('not configured')) {
      console.error('\nThis is a configuration issue, not a tool-slug issue - set COMPOSIO_API_KEY in your .env first, then re-run this script.');
    } else if (err.message.includes('No active') || err.message.includes('connection')) {
      console.error('\nThis means COMPOSIO_API_KEY is set, but no Google Calendar account is connected yet - go connect one in the Composio dashboard, then re-run this script.');
    } else {
      console.error('\nThis usually means the ACTION_SLUG guess in plugins/googlecalendar/actions/listEvents.js is wrong.');
      console.error('Check the error above for the correct tool slug (Composio often names it directly), then update ACTION_SLUG there.');
    }
  }
}

main();