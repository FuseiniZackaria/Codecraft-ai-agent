#!/usr/bin/env node
/**
 * Live check for Google Sheets lead storage: writes ONE sample lead to the
 * sheet in LEADS_SHEET_ID (or the sheet id passed as the first argument).
 *
 *   npm run check:sheets
 *   npm run check:sheets -- <sheet id or link>
 *
 * Needs GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE in .env,
 * and the sheet shared with the service account's client_email as Editor.
 * Running it twice shows the duplicate-email skip.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const googleSheets = require('../core/googleSheets');

async function main() {
  const arg = process.argv[2];
  if (arg) {
    const id = googleSheets.parseSheetId(arg);
    if (!id) throw new Error(`"${arg}" is not a Google Sheet link or id.`);
    process.env.LEADS_SHEET_ID = id;
  }
  console.log(`Service account: ${googleSheets.serviceAccountEmail() || '(not configured)'}`);
  console.log(`Sheet: ${process.env.LEADS_SHEET_ID || '(LEADS_SHEET_ID not set)'}`);

  const result = await googleSheets.saveLead({
    name: 'CodeCraft test lead',
    email: 'test-lead@example.com',
    phone: '+000 000 0000',
    source: 'scripts/check-sheets.js',
    notes: 'Connection check - safe to delete this row.',
  });
  console.log(`OK: ${result}`);
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
