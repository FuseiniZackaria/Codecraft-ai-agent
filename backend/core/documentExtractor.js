const mammoth = require('mammoth');
const XLSX = require('xlsx');

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// XLSX (SheetJS) reads both the modern OOXML .xlsx format and the legacy
// binary .xls format through the same API - both are worth supporting
// since older exports from other systems are still common.
const SPREADSHEET_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // legacy .xls
];

const EXTRACTABLE_TYPES = [DOCX_TYPE, ...SPREADSHEET_TYPES];

// Keeps one huge document from blowing the token budget or the request
// itself - the model gets a clear note that it was truncated rather than
// silently getting a cut-off, confusing analysis.
const MAX_EXTRACTED_CHARS = 15000;

function isExtractable(mediaType) {
  return EXTRACTABLE_TYPES.includes(mediaType);
}

function capText(text, filename) {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EXTRACTED_CHARS) return trimmed;
  return (
    trimmed.slice(0, MAX_EXTRACTED_CHARS) +
    `\n\n[...truncated - ${filename} is longer than fits in one message; showing the first ${MAX_EXTRACTED_CHARS} characters...]`
  );
}

/**
 * Extracts readable text from a Word or Excel attachment.
 * @param {{mediaType: string, data: string, filename: string}} attachment - base64-encoded
 * @returns {Promise<string>}
 */
async function extractText(attachment) {
  const buffer = Buffer.from(attachment.data, 'base64');

  if (attachment.mediaType === DOCX_TYPE) {
    const result = await mammoth.extractRawText({ buffer });
    return capText(result.value, attachment.filename);
  }

  if (SPREADSHEET_TYPES.includes(attachment.mediaType)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetTexts = workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      return `--- Sheet: ${name} ---\n${csv.trim()}`;
    });
    return capText(sheetTexts.join('\n\n'), attachment.filename);
  }

  throw new Error(`Unsupported document type: ${attachment.mediaType}`);
}

module.exports = { isExtractable, extractText, DOCX_TYPE, SPREADSHEET_TYPES };
