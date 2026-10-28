// Google Sheets through Composio: a workspace that signed in with Google
// saves leads with its OWN Composio account, never the service account, and
// another workspace can't use it. Composio is stubbed - no real calls.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';
process.env.GOOGLE_SERVICE_ACCOUNT_FILE = '';
process.env.LEADS_SHEET_ID = '';

const assert = require('assert');

const WS_A = 'aaaaaaaa-0000-0000-0000-0000000000a1';
const WS_B = 'bbbbbbbb-0000-0000-0000-0000000000b2';
const SHEET = 'composio_sheet_id_1234567890abcd';

async function main() {
  require('../core/workspaceContext').getAppOwnerWorkspaceId = async () => null;
  const composio = require('../core/composio');
  const connections = require('../core/workspaceConnections');
  const googleSheets = require('../core/googleSheets');
  googleSheets._resetForTests();

  // Fake Composio: one spreadsheet with a "Leads" tab, responses wrapped the
  // way Composio returns them (under response_data).
  const rows = [];
  const calls = [];
  composio.execute = async (slug, args, toolkit, opts) => {
    calls.push({ slug, args, toolkit, ws: opts.workspaceId });
    assert.strictEqual(toolkit, 'googlesheets');
    if (slug === 'GOOGLESHEETS_GET_SPREADSHEET_INFO') {
      return { response_data: { properties: { title: 'My Leads' }, sheets: [{ properties: { title: 'Leads' } }] } };
    }
    if (slug === 'GOOGLESHEETS_VALUES_GET') {
      if (args.range.endsWith('A1:F1')) return { response_data: { values: rows.slice(0, 1) } };
      return { response_data: { values: rows.slice(1).map((r) => r.slice(1, 5)) } };
    }
    if (slug === 'GOOGLESHEETS_VALUES_UPDATE') { rows[0] = args.values[0]; return {}; }
    if (slug === 'GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND') { rows.push(...args.values); return {}; }
    throw new Error(`unexpected ${slug}`);
  };

  // Signed in, no sheet yet: not configured, clear message.
  await connections.upsertConnection(WS_A, 'googlesheets', {
    composio_account_id: 'ca_A', status: 'connected', provider_meta: { composio_user_id: composio.entityFor(WS_A) },
  });
  assert.strictEqual(await googleSheets.isConfigured(WS_A), false);
  const st = await googleSheets.sheetsStatus(WS_A);
  assert.ok(st.attempted && /no sheet is chosen/.test(st.reason), 'half-connected is reported with a reason');
  assert.strictEqual((await googleSheets.sheetsStatus(WS_B)).attempted, false, 'never-connected stays quiet');
  await assert.rejects(googleSheets.saveLead({ name: 'X' }, { workspaceId: WS_A }), /no sheet is chosen/);
  console.log('✓ signed in without a sheet -> "choose a sheet" message');

  // Sheet chosen: access check + saves go through Composio for that workspace.
  const access = await googleSheets.checkAccess(SHEET, { workspaceId: WS_A });
  assert.deepStrictEqual(access, { title: 'Leads', spreadsheetTitle: 'My Leads' });
  await connections.upsertConnection(WS_A, 'googlesheets', {
    composio_account_id: 'ca_A', status: 'connected',
    provider_meta: { composio_user_id: composio.entityFor(WS_A), sheet_id: SHEET, sheet_title: 'My Leads', worksheet: 'Leads' },
  });
  assert.strictEqual(await googleSheets.isConfigured(WS_A), true, 'no service account needed');

  const msg = await googleSheets.saveLead({ name: 'Ama Mensah', email: 'ama@example.com', phone: '+233 20 000 0000', source: 'https://instagram.com/ama' }, { workspaceId: WS_A });
  assert.match(msg, /Saved lead Ama Mensah/);
  assert.deepStrictEqual(rows[0], googleSheets.HEADER, 'header row written');
  assert.strictEqual(rows[1][1], 'Ama Mensah');
  assert.strictEqual(rows[1][2], 'ama@example.com');
  const append = calls.find((c) => c.slug === 'GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND');
  assert.strictEqual(append.args.spreadsheetId, SHEET);
  assert.strictEqual(append.args.valueInputOption, 'RAW');
  assert.ok(calls.every((c) => c.ws === WS_A), 'every call runs as workspace A');
  console.log('✓ leads saved through Composio with the workspace\'s own account (header + row)');

  const dup = await googleSheets.saveLead({ name: 'Ama again', email: 'AMA@example.com' }, { workspaceId: WS_A });
  assert.match(dup, /already in the sheet/);
  assert.strictEqual(rows.length, 2);
  assert.match(await googleSheets.saveLead({ name: 'Someone else', source: 'https://instagram.com/ama' }, { workspaceId: WS_A }), /already in the sheet/);
  await googleSheets.saveLead({ name: 'Kofi Boateng', source: 'https://linkedin.com/in/kofi' }, { workspaceId: WS_A });
  assert.match(await googleSheets.saveLead({ name: 'kofi boateng' }, { workspaceId: WS_A }), /already in the sheet/);
  await googleSheets.saveLead({ name: 'Efua', email: 'efua@example.com.' }, { workspaceId: WS_A });
  assert.strictEqual(rows[rows.length - 1][2], 'efua@example.com', 'trailing dot stripped');
  assert.strictEqual(rows.length, 4);
  console.log('✓ duplicates skipped by email, profile link, or name (no email)');

  // Workspace B has nothing: not configured, never reaches A's sheet.
  calls.length = 0;
  assert.strictEqual(await googleSheets.isConfigured(WS_B), false);
  await assert.rejects(googleSheets.saveLead({ name: 'Y' }, { workspaceId: WS_B }), /not connected/);
  assert.strictEqual(calls.length, 0, 'no Composio call for B');
  console.log('✓ another workspace can\'t use it');

  // Google refuses the sheet -> plain message about the connected account.
  composio.execute = async () => { throw new Error('Composio GOOGLESHEETS_GET_SPREADSHEET_INFO failed: Requested entity was not found. 404'); };
  await assert.rejects(googleSheets.checkAccess(SHEET, { workspaceId: WS_A }), /Check the link, and that the Google account you connected can edit it/);
  console.log('✓ unopenable sheet -> clear error');

  console.log('\nAll Google Sheets (Composio) checks passed.');
}

main().catch((err) => { console.error(err); process.exit(1); });
