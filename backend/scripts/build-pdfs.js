#!/usr/bin/env node
/**
 * build-pdfs.js — turns the markdown docs into two PDFs under docs/pdf/.
 *
 * Output:
 *   docs/pdf/CodeCraft - Why Your Business Needs It.pdf
 *     (cover + why-codecraft.md). ≤ 6 pages including the cover.
 *   docs/pdf/CodeCraft - Full Documentation.pdf
 *     (cover + TOC + the full docs set). ≤ 30 pages.
 *
 * Requires `md-to-pdf` as a dev dependency. Uses Puppeteer under the hood;
 * the first run downloads Chromium (~200 MB).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const OUT  = path.join(DOCS, 'pdf');

function mustRead(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) throw new Error(`Missing input: ${relPath}`);
  return fs.readFileSync(abs, 'utf8');
}

// Tight stylesheet — small enough margins and font to fit the page budgets
// above, but still readable. Reduced h1/h2 size, dense table padding, no
// forced page-break on every heading (only on explicit <div class="pb"/>).
const CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #24292e; font-size: 10pt; line-height: 1.35; max-width: 800px; margin: 0 auto; padding: 20px 32px; }
  h1 { font-size: 18pt; border-bottom: 1.5px solid #eaecef; padding-bottom: 4px; margin-top: 1.1em; }
  h2 { font-size: 13pt; border-bottom: 1px solid #eaecef; padding-bottom: 2px; margin-top: 1em; }
  h3 { font-size: 11pt; margin-top: 0.9em; }
  h4 { font-size: 10pt; margin-top: 0.8em; }
  p, li { font-size: 10pt; margin: 0.3em 0; }
  ul, ol { padding-left: 20px; margin: 0.3em 0; }
  code { background: #f3f4f6; padding: 0 4px; border-radius: 3px; font-family: ui-monospace, Consolas, monospace; font-size: 9pt; }
  pre { background: #f6f8fa; padding: 8px; border-radius: 4px; overflow: auto; font-size: 8.5pt; line-height: 1.3; margin: 0.4em 0; }
  pre code { background: transparent; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 0.5em 0; page-break-inside: auto; }
  th, td { border: 1px solid #dfe2e5; padding: 4px 6px; text-align: left; font-size: 9pt; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  blockquote { color: #6a737d; border-left: 3px solid #dfe2e5; margin: 0; padding: 0 10px; }
  hr { border: 0; border-top: 1px solid #e1e4e8; margin: 1em 0; }
  a { color: #0366d6; text-decoration: none; }
  .cover { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; min-height: 72vh; page-break-after: always; }
  .cover .title { font-size: 32pt; font-weight: 700; margin-bottom: 0.3em; }
  .cover .subtitle { font-size: 14pt; color: #586069; margin-bottom: 1.5em; }
  .cover .meta { font-size: 10pt; color: #586069; }
  .pb { page-break-before: always; }
`;

function stripFront(md) {
  // Drop leading horizontal rules that would create a blank first page.
  return md.replace(/^(---\s*\n)+/g, '');
}

function buildCover(title, subtitle) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    `<div class="cover">\n` +
    `  <div class="title">${title}</div>\n` +
    `  <div class="subtitle">${subtitle}</div>\n` +
    `  <div class="meta">Generated: ${today}</div>\n` +
    `</div>\n\n`
  );
}

function buildToc(chapters) {
  const items = chapters
    .map((c, i) => `  <li>${i + 1}. ${c.title}</li>`)
    .join('\n');
  return (
    `<h1>Contents</h1>\n` +
    `<ol>\n${items}\n</ol>\n` +
    `<div class="pb"></div>\n\n`
  );
}

async function buildOne({ outFile, title, subtitle, chapters, includeToc }) {
  const { mdToPdf } = require('md-to-pdf');

  const parts = [];
  parts.push(buildCover(title, subtitle));
  if (includeToc) parts.push(buildToc(chapters));
  chapters.forEach((ch, i) => {
    if (i > 0) parts.push(`<div class="pb"></div>\n\n`);
    parts.push(stripFront(ch.body));
  });

  const result = await mdToPdf(
    { content: parts.join('\n') },
    {
      dest: outFile,
      stylesheet_encoding: 'utf-8',
      css: CSS,
      pdf_options: {
        format: 'A4',
        margin: { top: '14mm', bottom: '13mm', left: '12mm', right: '12mm' },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          '<div style="font-size:8pt;color:#888;width:100%;text-align:center;">' +
          '  Page <span class="pageNumber"></span> of <span class="totalPages"></span>' +
          '</div>',
      },
    }
  );
  if (!result) throw new Error(`PDF build returned nothing for ${outFile}`);

  const pages = countPages(outFile);
  console.log(`  → ${path.relative(ROOT, outFile)}  (${pages ?? '?'} pages)`);
  return pages;
}

/**
 * Count PDF pages by scanning the raw bytes for the /Count N entry under
 * /Type /Pages. Works for Chromium-produced PDFs even though the content
 * streams are compressed, because the catalog tree stays uncompressed.
 */
function countPages(pdfPath) {
  try {
    const buf = fs.readFileSync(pdfPath);
    const asBinary = buf.toString('binary');
    // A PDF has one /Type /Page per actual page. Count those directly —
    // the catalog's /Count isn't easy to disambiguate from sub-tree
    // counts without a full parser, but /Type /Page is one-per-page
    // across every writer.
    const pageMatches = asBinary.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatches && pageMatches.length > 0) return pageMatches.length;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  // PDF 1 — the business-facing pitch. One chapter, no TOC, cover only.
  const whyPages = await buildOne({
    outFile: path.join(OUT, 'CodeCraft - Why Your Business Needs It.pdf'),
    title: 'CodeCraft',
    subtitle: 'Why your business needs it',
    chapters: [
      { title: 'Why CodeCraft', body: mustRead('docs/why-codecraft.md') },
    ],
    includeToc: false,
  });

  // PDF 2 — the full reference. Testing is excluded (file stays in /docs).
  const fullPages = await buildOne({
    outFile: path.join(OUT, 'CodeCraft - Full Documentation.pdf'),
    title: 'CodeCraft',
    subtitle: 'Complete documentation',
    chapters: [
      { title: 'Overview',          body: mustRead('README.md') },
      { title: 'Why CodeCraft',     body: mustRead('docs/why-codecraft.md') },
      { title: 'User guide',        body: mustRead('docs/user-guide.md') },
      { title: 'Setup and deploy',  body: mustRead('docs/setup-and-deploy.md') },
      { title: 'Architecture',      body: mustRead('docs/architecture.md') },
      { title: 'Agents',            body: mustRead('docs/agents.md') },
      { title: 'API',               body: mustRead('docs/api.md') },
      { title: 'Operations',        body: mustRead('docs/operations.md') },
      { title: 'Changelog',         body: mustRead('docs/changelog.md') },
    ],
    includeToc: true,
  });

  const errs = [];
  if (whyPages !== null && whyPages > 6) {
    errs.push(`Pitch PDF is ${whyPages} pages — target is ≤ 6.`);
  }
  if (fullPages !== null && fullPages > 30) {
    errs.push(`Full PDF is ${fullPages} pages — target is ≤ 30.`);
  }
  if (errs.length) {
    console.warn('\nWARNING(S):');
    errs.forEach((e) => console.warn('  ' + e));
    process.exit(2);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('PDF build failed:', err.message);
  console.error(
    'If the error mentions Chromium or Puppeteer, the first run can time ' +
      'out while downloading. Re-run `node backend/scripts/build-pdfs.js`.'
  );
  process.exit(1);
});
