const fs = require('fs');
const { google } = require('googleapis');

/**
 * Google Sheets lead storage.
 *
 * Auth: one Google service account for the whole server, read from
 *   GOOGLE_SERVICE_ACCOUNT_JSON  (the key file's JSON pasted into an env var -
 *                                 easiest on Render), or
 *   GOOGLE_SERVICE_ACCOUNT_FILE  (path to the key file, e.g. a Render Secret
 *                                 File at /etc/secrets/google-sa.json).
 * Each workspace shares its own sheet with the service account's client_email.
 *
 * Which sheet: the workspace's own "googlesheets" connection (Connections
 * page). LEADS_SHEET_ID is a fallback for the app owner's workspace (and
 * background callers with no workspace) only - another workspace never writes
 * into the owner's sheet.
 */

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const HEADER = ['timestamp', 'name', 'email', 'phone', 'source', 'notes'];

let client = null;
let cachedCredentials = null;

class SheetsConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SheetsConfigError';
    this.code = 'SHEETS_NOT_CONFIGURED';
  }
}

function loadCredentials() {
  if (cachedCredentials) return cachedCredentials;
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  let raw = null;
  if (inline && inline.trim()) {
    raw = inline;
  } else if (file && file.trim()) {
    if (!fs.existsSync(file)) {
      throw new SheetsConfigError(`GOOGLE_SERVICE_ACCOUNT_FILE points to "${file}", but that file does not exist.`);
    }
    raw = fs.readFileSync(file, 'utf8');
  } else {
    throw new SheetsConfigError(
      'Google Sheets is not set up on this server: set GOOGLE_SERVICE_ACCOUNT_JSON (the service-account key JSON) ' +
      'or GOOGLE_SERVICE_ACCOUNT_FILE (path to the key file).'
    );
  }
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new SheetsConfigError('The Google service-account key is not valid JSON.');
  }
  if (!creds.client_email || !creds.private_key) {
    throw new SheetsConfigError('The Google service-account key is missing client_email or private_key.');
  }
  cachedCredentials = creds;
  return creds;
}

/** The address each workspace must share its sheet with (as Editor). */
function serviceAccountEmail() {
  try {
    return loadCredentials().client_email;
  } catch {
    return null;
  }
}

function getClient() {
  if (client) return client;
  const creds = loadCredentials();
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  client = google.sheets({ version: 'v4', auth });
  return client;
}

/** Accepts a bare sheet id or a full https://docs.google.com/spreadsheets/d/<id>/... URL. */
function parseSheetId(input) {
  const text = String(input || '').trim();
  const fromUrl = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = fromUrl ? fromUrl[1] : text;
  return /^[a-zA-Z0-9-_]{20,}$/.test(id) ? id : null;
}

async function resolveSheetId(workspaceId) {
  if (workspaceId) {
    const conn = await require('./workspaceConnections').getConnection(workspaceId, 'googlesheets');
    if (conn?.status === 'connected' && conn.provider_meta?.sheet_id) return conn.provider_meta.sheet_id;
  }
  const fallback = process.env.LEADS_SHEET_ID;
  const ownerOk = !workspaceId || await require('./workspaceContext').canSeeLegacy(workspaceId);
  if (fallback && ownerOk) return fallback;
  throw new SheetsConfigError(
    workspaceId
      ? 'No leads sheet is connected for this workspace - add one on the Connections page (Google Sheets).'
      : 'LEADS_SHEET_ID is not set.'
  );
}

/** True when a save would have somewhere to go - lets callers skip quietly when Sheets isn't set up. */
async function isConfigured(workspaceId) {
  try {
    loadCredentials();
    await resolveSheetId(workspaceId);
    return true;
  } catch {
    return false;
  }
}

// Google returns 403 (no access) or 404 (wrong id / not visible to the
// service account) for a sheet that isn't shared with it.
function explainGoogleError(err, sheetId) {
  const status = err?.code || err?.response?.status;
  const email = serviceAccountEmail() || 'the service account';
  if (status === 403 || status === 404) {
    return new SheetsConfigError(
      `Can't open Google Sheet ${sheetId}. Share it with ${email} as an Editor, and check the sheet id is right.`
    );
  }
  return new Error(`Google Sheets error: ${err?.message || err}`);
}

const quoteTitle = (title) => `'${String(title).replace(/'/g, "''")}'`;

async function firstSheetTitle(sheets, sheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title,sheets.properties.title' });
  const title = meta?.data?.sheets?.[0]?.properties?.title;
  if (!title) throw new Error('The spreadsheet has no worksheets.');
  return { title, spreadsheetTitle: meta?.data?.properties?.title || null };
}

/** Checks the server can open the sheet (used when a workspace connects one). */
async function checkAccess(sheetId) {
  const sheets = getClient();
  try {
    return await firstSheetTitle(sheets, sheetId);
  } catch (err) {
    throw explainGoogleError(err, sheetId);
  }
}

/**
 * Appends a lead to the first worksheet: timestamp (UTC ISO), name, email,
 * phone, source, notes. Writes the header row first if the sheet has none.
 * Skips (and says so) when a row with the same email already exists,
 * compared case-insensitively. Only `name` is required.
 */
async function saveLead({ name, email, phone, source, notes } = {}, { workspaceId = null } = {}) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('saveLead needs a name.');
  const cleanEmail = String(email || '').trim();

  const sheetId = await resolveSheetId(workspaceId);
  const sheets = getClient();

  try {
    const { title } = await firstSheetTitle(sheets, sheetId);
    const tab = quoteTitle(title);

    const head = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A1:F1` });
    const headerRow = head?.data?.values?.[0] || [];
    if (headerRow.every((cell) => !String(cell || '').trim())) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${tab}!A1:F1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADER] },
      });
    }

    if (cleanEmail) {
      const col = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!C2:C` });
      const wanted = cleanEmail.toLowerCase();
      const exists = (col?.data?.values || []).some((row) => String(row?.[0] || '').trim().toLowerCase() === wanted);
      if (exists) return `Lead not saved: ${cleanEmail} is already in the sheet.`;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tab}!A:F`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          new Date().toISOString(),
          cleanName,
          cleanEmail,
          String(phone || '').trim(),
          String(source || '').trim(),
          String(notes || '').trim(),
        ]],
      },
    });
    return `Saved lead ${cleanName}${cleanEmail ? ` (${cleanEmail})` : ''} to the sheet.`;
  } catch (err) {
    if (err instanceof SheetsConfigError) throw err;
    throw explainGoogleError(err, sheetId);
  }
}

/** Test hook: inject a fake Sheets client / credentials. */
function _resetForTests({ sheetsClient = null, credentials = null } = {}) {
  client = sheetsClient;
  cachedCredentials = credentials;
}

module.exports = {
  saveLead,
  checkAccess,
  isConfigured,
  parseSheetId,
  serviceAccountEmail,
  SheetsConfigError,
  HEADER,
  _resetForTests,
};
