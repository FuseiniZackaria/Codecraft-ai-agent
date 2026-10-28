// Google Sheets lead storage: saveLead against a fake Sheets client (no real
// Google calls - the safe-mode runner forbids them). The live check is
// `npm run check:sheets`.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';
process.env.GOOGLE_SERVICE_ACCOUNT_FILE = '';
process.env.LEADS_SHEET_ID = '';

const assert = require('assert');

const OWNER_WS = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_WS = 'bbbbbbbb-0000-0000-0000-00000000000b';
const OWNER_SHEET = 'owner_sheet_id_1234567890abcdef';
const OTHER_SHEET = 'other_sheet_id_1234567890abcdef';

// Minimal in-memory spreadsheet: { sheetId: [[row], ...] } on one tab "Leads".
function fakeSheets({ deny = [] } = {}) {
  const data = {};
  const calls = [];
  const rows = (id) => (data[id] ||= []);
  const guard = (id) => {
    if (deny.includes(id)) throw Object.assign(new Error('The caller does not have permission'), { code: 403 });
  };
  return {
    data, calls,
    spreadsheets: {
      async get({ spreadsheetId }) {
        guard(spreadsheetId);
        calls.push(['get', spreadsheetId]);
        return { data: { properties: { title: 'My Leads' }, sheets: [{ properties: { title: 'Leads' } }] } };
      },
      values: {
        async get({ spreadsheetId, range }) {
          guard(spreadsheetId);
          calls.push(['values.get', spreadsheetId, range]);
          const r = rows(spreadsheetId);
          if (range.endsWith('!A1:F1')) return { data: { values: r[0] ? [r[0]] : undefined } };
          if (range.endsWith('!B2:E')) return { data: { values: r.slice(1).map((row) => row.slice(1, 5)) } };
          throw new Error(`unexpected range ${range}`);
        },
        async update({ spreadsheetId, range, requestBody }) {
          calls.push(['update', spreadsheetId, range]);
          rows(spreadsheetId)[0] = requestBody.values[0];
          return {};
        },
        async append({ spreadsheetId, range, requestBody }) {
          calls.push(['append', spreadsheetId, range]);
          rows(spreadsheetId).push(requestBody.values[0]);
          return {};
        },
      },
    },
  };
}

async function main() {
  const googleSheets = require('../core/googleSheets');
  const connections = require('../core/workspaceConnections');
  require('../core/workspaceContext').getAppOwnerWorkspaceId = async () => OWNER_WS;

  // --- Missing configuration gives a clear error ---
  googleSheets._resetForTests();
  await assert.rejects(() => googleSheets.saveLead({ name: 'A' }, { workspaceId: OWNER_WS }),
    (err) => err.code === 'SHEETS_NOT_CONFIGURED' && /GOOGLE_SERVICE_ACCOUNT_JSON/.test(err.message) || /LEADS_SHEET_ID|not connected/.test(err.message));
  assert.strictEqual(await googleSheets.isConfigured(OWNER_WS), false);
  console.log('✓ missing service account / sheet id -> clear error, isConfigured false');

  const creds = { client_email: 'leads-bot@proj.iam.gserviceaccount.com', private_key: '-----FAKE-----' };
  let sheets = fakeSheets();
  googleSheets._resetForTests({ sheetsClient: sheets, credentials: creds });
  process.env.LEADS_SHEET_ID = OWNER_SHEET;

  // --- Name is required ---
  await assert.rejects(() => googleSheets.saveLead({ email: 'x@y.com' }, { workspaceId: OWNER_WS }), /needs a name/);
  console.log('✓ name is required');

  // --- First save writes the header, then the row ---
  const first = await googleSheets.saveLead(
    { name: 'Ama Bakery', email: 'Hello@AmaBakery.com', phone: '+233 20 000 0000', source: 'https://maps.example/ama', notes: 'bakery | Accra' },
    { workspaceId: OWNER_WS },
  );
  assert.match(first, /^Saved lead Ama Bakery \(Hello@AmaBakery\.com\)/);
  const sheet = sheets.data[OWNER_SHEET];
  assert.deepStrictEqual(sheet[0], googleSheets.HEADER, 'header row created');
  assert.deepStrictEqual(sheet[0], ['timestamp', 'name', 'email', 'phone', 'source', 'notes']);
  const [ts, ...rest] = sheet[1];
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(ts), `timestamp is UTC ISO: ${ts}`);
  assert.deepStrictEqual(rest, ['Ama Bakery', 'Hello@AmaBakery.com', '+233 20 000 0000', 'https://maps.example/ama', 'bakery | Accra']);
  assert.ok(sheets.calls.some((c) => c[0] === 'append' && c[2] === "'Leads'!A:F"), 'appends to the first worksheet');
  console.log('✓ first save creates the header row and appends timestamp, name, email, phone, source, notes');

  // --- Header is not rewritten; duplicate email (case-insensitive) is skipped ---
  const updatesBefore = sheets.calls.filter((c) => c[0] === 'update').length;
  const dup = await googleSheets.saveLead({ name: 'Ama again', email: '  hello@amabakery.COM ' }, { workspaceId: OWNER_WS });
  assert.match(dup, /already in the sheet/);
  assert.strictEqual(sheet.length, 2, 'no row added for a duplicate email');
  assert.strictEqual(sheets.calls.filter((c) => c[0] === 'update').length, updatesBefore, 'header not rewritten');
  console.log('✓ duplicate email (case-insensitive) is skipped with a message; header not rewritten');

  // --- Optional fields ---
  const minimal = await googleSheets.saveLead({ name: 'Kofi Tailors' }, { workspaceId: OWNER_WS });
  assert.strictEqual(minimal, 'Saved lead Kofi Tailors to the sheet.');
  assert.deepStrictEqual(sheet[2].slice(1), ['Kofi Tailors', '', '', '', '']);
  console.log('✓ only name is required; other columns are left blank');

  // --- Another workspace never falls back to the owner's LEADS_SHEET_ID ---
  await assert.rejects(() => googleSheets.saveLead({ name: 'X' }, { workspaceId: OTHER_WS }), /Google Sheets is not connected for this workspace/);
  assert.strictEqual(await googleSheets.isConfigured(OTHER_WS), false);
  await connections.upsertConnection(OTHER_WS, 'googlesheets', { provider_meta: { sheet_id: OTHER_SHEET }, status: 'connected' });
  await googleSheets.saveLead({ name: 'Other Co', email: 'hi@other.co' }, { workspaceId: OTHER_WS });
  assert.strictEqual(sheets.data[OTHER_SHEET][1][1], 'Other Co');
  assert.strictEqual(sheets.data[OWNER_SHEET].length, 3, 'nothing written to the owner sheet');
  console.log('✓ each workspace writes to its own sheet; LEADS_SHEET_ID is owner-only');

  // --- Sheet not shared with the service account ---
  sheets = fakeSheets({ deny: [OWNER_SHEET] });
  googleSheets._resetForTests({ sheetsClient: sheets, credentials: creds });
  await assert.rejects(() => googleSheets.saveLead({ name: 'Y' }, { workspaceId: OWNER_WS }),
    (err) => err.code === 'SHEETS_NOT_CONFIGURED' && err.message.includes('leads-bot@proj.iam.gserviceaccount.com') && /Editor/.test(err.message));
  console.log('✓ a sheet not shared with the service account -> error naming the address to share with');

  // --- Sheet link parsing ---
  assert.strictEqual(googleSheets.parseSheetId(`https://docs.google.com/spreadsheets/d/${OWNER_SHEET}/edit#gid=0`), OWNER_SHEET);
  assert.strictEqual(googleSheets.parseSheetId(OWNER_SHEET), OWNER_SHEET);
  assert.strictEqual(googleSheets.parseSheetId('not a sheet'), null);
  console.log('✓ accepts a full sheet link or a bare id');

  // --- Registered as an agent tool ---
  const { loadPlugins } = require('../core/pluginLoader');
  loadPlugins();
  const toolRegistry = require('../tools/ToolRegistry');
  assert.ok(toolRegistry.has('sheets.saveLead'), 'sheets.saveLead is registered');
  assert.strictEqual(toolRegistry.isIrreversible('sheets.saveLead'), false, 'no approval gate for saving a lead');
  sheets = fakeSheets();
  googleSheets._resetForTests({ sheetsClient: sheets, credentials: creds });
  const viaTool = await toolRegistry.call('sheets.saveLead', { name: 'Tool Lead', email: 't@x.com' }, { role: 'sales', workspaceId: OWNER_WS });
  assert.match(viaTool, /^Saved lead Tool Lead/);
  console.log('✓ sheets.saveLead tool returns the result string to the caller');

  console.log('\nAll Google Sheets lead storage checks passed.');
}

main().catch((err) => {
  console.error('✗ sheets-save-lead.test.js failed:', err);
  process.exit(1);
});
