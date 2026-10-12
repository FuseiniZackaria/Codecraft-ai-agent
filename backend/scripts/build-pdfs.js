#!/usr/bin/env node
/**
 * build-pdfs.js — turns the markdown docs into two PDFs under docs/pdf/.
 *
 * Output:
 *   docs/pdf/CodeCraft - Why Your Business Needs It.pdf
 *     (docs/why-codecraft.md + docs/agent-value.md, with a cover and TOC)
 *   docs/pdf/CodeCraft - Full Documentation.pdf
 *     (every doc in sensible order, with a cover, TOC, and page numbers)
 *
 * Requires `md-to-pdf` as a dev dependency (installed in backend/package.json).
 * md-to-pdf uses Puppeteer; the first run downloads Chromium (~200 MB) and
 * takes a minute or two.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');   // repo root
const DOCS = path.join(ROOT, 'docs');
const OUT  = path.join(DOCS, 'pdf');

function mustRead(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing input: ${relPath}`);
  }
  return fs.readFileSync(abs, 'utf8');
}

// Stripped-down GitHub-ish stylesheet. Keep inside the file (no external
// CSS) so the build is reproducible and the PDFs render identically.
const CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #24292e; font-size: 11pt; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 36px 48px; }
  h1 { font-size: 24pt; border-bottom: 2px solid #eaecef; padding-bottom: 8px; margin-top: 1.5em; page-break-before: always; }
  h1:first-of-type { page-break-before: avoid; }
  h2 { font-size: 17pt; border-bottom: 1px solid #eaecef; padding-bottom: 4px; margin-top: 1.4em; }
  h3 { font-size: 13pt; margin-top: 1.3em; }
  h4 { font-size: 11pt; margin-top: 1.2em; }
  p, li { font-size: 11pt; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 10pt; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 5px; overflow: auto; font-size: 9.5pt; line-height: 1.4; }
  pre code { background: transparent; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; page-break-inside: avoid; }
  th, td { border: 1px solid #dfe2e5; padding: 6px 10px; text-align: left; font-size: 10pt; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  blockquote { color: #6a737d; border-left: 4px solid #dfe2e5; margin: 0; padding: 0 16px; }
  hr { border: 0; border-top: 1px solid #e1e4e8; margin: 2em 0; }
  a { color: #0366d6; text-decoration: none; }
  .cover { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; min-height: 70vh; page-break-after: always; }
  .cover .title { font-size: 36pt; font-weight: 700; margin-bottom: 0.4em; }
  .cover .subtitle { font-size: 16pt; color: #586069; margin-bottom: 2em; }
  .cover .meta { font-size: 11pt; color: #586069; }
  .toc { page-break-after: always; }
  .toc h1 { page-break-before: avoid; }
  .toc ol { font-size: 12pt; line-height: 2; padding-left: 20px; }
`;

function stripFrontRedundancy(md) {
  // Each source file starts with "# Title" — we want that preserved for a
  // visible chapter header in the combined PDF, but we drop any explicit
  // "---" separators at the top that would otherwise create blank pages.
  return md.replace(/^(---\s*\n)+/g, '');
}

function makePageBreak() {
  return '\n\n<div style="page-break-before: always"></div>\n\n';
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
    `<div class="toc">\n` +
    `<h1>Table of contents</h1>\n` +
    `<ol>\n${items}\n</ol>\n` +
    `</div>\n\n`
  );
}

/**
 * Build one PDF by concatenating markdown bodies with page breaks between
 * chapters, prepended with a cover + a TOC.
 */
async function buildOne({ outFile, title, subtitle, chapters }) {
  const { mdToPdf } = require('md-to-pdf');

  const parts = [];
  parts.push(buildCover(title, subtitle));
  parts.push(buildToc(chapters));
  for (const ch of chapters) {
    parts.push(stripFrontRedundancy(ch.body));
    parts.push(makePageBreak());
  }
  const combined = parts.join('\n');

  const result = await mdToPdf(
    { content: combined },
    {
      dest: outFile,
      stylesheet_encoding: 'utf-8',
      css: CSS,
      pdf_options: {
        format: 'A4',
        margin: { top: '28mm', bottom: '22mm', left: '18mm', right: '18mm' },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          '<div style="font-size:9pt;color:#888;width:100%;text-align:center;">' +
          '  Page <span class="pageNumber"></span> of <span class="totalPages"></span>' +
          '</div>',
      },
    }
  );
  if (!result) throw new Error(`PDF build returned nothing for ${outFile}`);
  console.log(`  → ${path.relative(ROOT, outFile)}`);
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  // PDF 1 — the pitch PDF for business owners.
  const whyChapters = [
    { title: 'Why CodeCraft', body: mustRead('docs/why-codecraft.md') },
    { title: 'What each agent takes off your plate', body: mustRead('docs/agent-value.md') },
  ];
  await buildOne({
    outFile: path.join(OUT, 'CodeCraft - Why Your Business Needs It.pdf'),
    title: 'CodeCraft',
    subtitle: 'Why your business needs it',
    chapters: whyChapters,
  });

  // PDF 2 — the complete reference.
  const fullChapters = [
    { title: 'Overview',           body: mustRead('README.md') },
    { title: 'Why CodeCraft',      body: mustRead('docs/why-codecraft.md') },
    { title: 'Agent value',        body: mustRead('docs/agent-value.md') },
    { title: 'User guide',         body: mustRead('docs/user-guide.md') },
    { title: 'Setup guide',        body: mustRead('docs/setup-guide.md') },
    { title: 'Deployment',         body: mustRead('docs/deployment.md') },
    { title: 'Architecture',       body: mustRead('docs/architecture.md') },
    { title: 'Workspaces',         body: mustRead('docs/workspaces.md') },
    { title: 'Agents reference',   body: mustRead('docs/agents.md') },
    { title: 'API reference',      body: mustRead('docs/api.md') },
    { title: 'Testing',            body: mustRead('docs/testing.md') },
    { title: 'Runbooks',           body: mustRead('docs/runbooks.md') },
    { title: 'Troubleshooting',    body: mustRead('docs/troubleshooting.md') },
    { title: 'Changelog',          body: mustRead('docs/changelog.md') },
  ];
  await buildOne({
    outFile: path.join(OUT, 'CodeCraft - Full Documentation.pdf'),
    title: 'CodeCraft',
    subtitle: 'Complete documentation',
    chapters: fullChapters,
  });

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
