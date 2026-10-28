const fs = require('fs');
const { google } = require('googleapis');

/**
 * Google Sheets lead storage.
 *
 * Auth, per workspace: the workspace connects its own Google account through
 * Composio (Connections -> Google Sheets -> Connect, like Gmail) and then
 * picks the sheet. Calls run as that workspace's Composio account only.
 *
 * Fallback for the app owner / background jobs: a Google service account
 * (GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE) writing to
 * LEADS_SHEET_ID. Another workspace never writes into the owner's sheet.
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

function getServiceAccountClient() {
  if (client) return client;
  const creds = loadCredentials();
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  client = google.sheets({ version: 'v4', auth });
  return client;
}

// Composio responses wrap the Google payload differently per action/version.
function unwrap(d, key) {
  for (const c of [d, d?.data, d?.response_data, d?.valueRange, d?.data?.response_data]) {
    if (c && typeof c === 'object' && key in c) return c;
  }
  return d || {};
}

/**
 * The same shape as the googleapis Sheets client (spreadsheets.get,
 * spreadsheets.values.get/update/append), backed by Composio and running as
 * this workspace's own connected Google account.
 */
function composioClient(workspaceId) {
  const run = (slug, args) => require('./composio').execute(slug, args, 'googlesheets', { workspaceId });
  return {
    spreadsheets: {
      get: async ({ spreadsheetId }) => ({
        data: unwrap(await run('GOOGLESHEETS_GET_SPREADSHEET_INFO', { spreadsheet_id: spreadsheetId }), 'sheets'),
      }),
      values: {
        get: async ({ spreadsheetId, range }) => ({
          data: { values: unwrap(await run('GOOGLESHEETS_VALUES_GET', { spreadsheet_id: spreadsheetId, range }), 'values').values || [] },
        }),
        update: async ({ spreadsheetId, range, valueInputOption, requestBody }) => ({
          data: await run('GOOGLESHEETS_VALUES_UPDATE', {
            spreadsheet_id: spreadsheetId, range, value_input_option: valueInputOption, values: requestBody.values,
          }),
        }),
        append: async ({ spreadsheetId, range, valueInputOption, insertDataOption, requestBody }) => ({
          data: await run('GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND', {
            spreadsheetId, range, valueInputOption, insertDataOption, values: requestBody.values,
          }),
        }),
      },
    },
  };
}

async function sheetsConnection(workspaceId) {
  if (!workspaceId) return null;
  const conn = await require('./workspaceConnections').getConnection(workspaceId, 'googlesheets');
  return conn?.status === 'connected' && conn.composio_account_id ? conn : null;
}

// A workspace with its own Composio Google account uses it; otherwise the
// server's service account (owner fallback).
async function getClient(workspaceId) {
  if (await sheetsConnection(workspaceId)) return { sheets: composioClient(workspaceId), via: 'composio' };
  return { sheets: getServiceAccountClient(), via: 'service_account' };
}

/** Accepts a bare sheet id or a full https://docs.google.com/spreadsheets/d/<id>/... URL. */
function parseSheetId(input) {
  const text = String(input || '').trim();
  const fromUrl = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = fromUrl ? fromUrl[1] : text;
  return /^[a-zA-Z0-9-_]{20,}$/.test(id) ? id : null;
}

async function resolveSheetId(workspaceId) {
  const conn = await sheetsConnection(workspaceId);
  if (conn) {
    if (conn.provider_meta?.sheet_id) return conn.provider_meta.sheet_id;
    throw new SheetsConfigError('Google Sheets is connected but no sheet is chosen yet - paste the sheet link on the Connections page.');
  }
  if (workspaceId) {
    const old = await require('./workspaceConnections').getConnection(workspaceId, 'googlesheets');
    // Pre-Composio rows (sheet shared with the service account) keep working.
    if (old?.status === 'connected' && old.provider_meta?.sheet_id && !old.composio_account_id) return old.provider_meta.sheet_id;
  }
  const fallback = process.env.LEADS_SHEET_ID;
  const ownerOk = !workspaceId || await require('./workspaceContext').canSeeLegacy(workspaceId);
  if (fallback && ownerOk) return fallback;
  throw new SheetsConfigError(
    workspaceId
      ? 'Google Sheets is not connected for this workspace - connect it on the Connections page.'
      : 'LEADS_SHEET_ID is not set.'
  );
}

/**
 * Whether a save would have somewhere to go. `attempted` is true when the
 * workspace started setting Sheets up (has a row) - callers report `reason`
 * then, and stay quiet only for a workspace that never connected Sheets.
 */
async function sheetsStatus(workspaceId) {
  const row = workspaceId ? await require('./workspaceConnections').getConnection(workspaceId, 'googlesheets') : null;
  try {
    await resolveSheetId(workspaceId);
    if (!(await sheetsConnection(workspaceId))) loadCredentials();
    return { ok: true, attempted: true, reason: null };
  } catch (err) {
    return { ok: false, attempted: !!row || !!process.env.LEADS_SHEET_ID, reason: err.message };
  }
}

/** True when a save would have somewhere to go. */
async function isConfigured(workspaceId) {
  return (await sheetsStatus(workspaceId)).ok;
}

// Google returns 403 (no access) or 404 (wrong id / not visible to the
// service account) for a sheet that isn't shared with it.
function explainGoogleError(err, sheetId, via = 'service_account') {
  const status = err?.code || err?.response?.status;
  const email = serviceAccountEmail() || 'the service account';
  const googleMsg = err?.response?.data?.error?.message || err?.message || '';
  if (err?.code === 'WORKSPACE_CONNECTION_MISSING') return new SheetsConfigError(err.message);
  if (via === 'composio') {
    if (/not found|404|permission|403|does not have access|caller does not have/i.test(googleMsg)) {
      return new SheetsConfigError(
        `Can't open Google Sheet ${sheetId}. Check the link, and that the Google account you connected can edit it.` +
        (googleMsg ? ` (Google said: ${googleMsg.slice(0, 300)})` : '')
      );
    }
    return new Error(`Google Sheets error: ${googleMsg.slice(0, 500)}`);
  }
  // Google also answers 403 when the Sheets API isn't enabled in the
  // service account's project - say that instead of blaming sharing.
  if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(googleMsg)) {
    const project = googleMsg.match(/project (\d+)/)?.[1];
    return new SheetsConfigError(
      'The Google Sheets API is not enabled for the service account\'s Google Cloud project. ' +
      `Enable it at https://console.cloud.google.com/apis/library/sheets.googleapis.com${project ? `?project=${project}` : ''}, ` +
      'wait a minute, then try again.'
    );
  }
  // An uploaded .xlsx (not converted to Google Sheets) can't be edited through the API.
  if (/not supported for this document/i.test(googleMsg)) {
    return new SheetsConfigError(
      'That file is an uploaded Excel file, not a Google Sheet. Open it and use File -> Save as Google Sheets, then connect the new sheet.'
    );
  }
  if (status === 403 || status === 404) {
    return new SheetsConfigError(
      `Can't open Google Sheet ${sheetId}. Share it with ${email} as an Editor, and check the sheet id is right.` +
      (googleMsg ? ` (Google said: ${googleMsg})` : '')
    );
  }
  return new Error(`Google Sheets error: ${googleMsg || err}`);
}

const quoteTitle = (title) => `'${String(title).replace(/'/g, "''")}'`;

async function firstSheetTitle(sheets, sheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title,sheets.properties.title' });
  const title = meta?.data?.sheets?.[0]?.properties?.title;
  if (!title) throw new Error('The spreadsheet has no worksheets.');
  return { title, spreadsheetTitle: meta?.data?.properties?.title || null };
}

/** Checks the workspace's Google account (or the service account) can open the sheet. */
async function checkAccess(sheetId, { workspaceId = null } = {}) {
  const { sheets, via } = await getClient(workspaceId);
  try {
    return await firstSheetTitle(sheets, sheetId);
  } catch (err) {
    throw explainGoogleError(err, sheetId, via);
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
  const { sheets, via } = await getClient(workspaceId);

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
    throw explainGoogleError(err, sheetId, via);
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
  sheetsStatus,
  parseSheetId,
  serviceAccountEmail,
  SheetsConfigError,
  HEADER,
  _resetForTests,
};
