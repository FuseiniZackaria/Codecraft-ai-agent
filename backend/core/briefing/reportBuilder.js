const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat,
} = require('docx');

/**
 * reportBuilder.js - turns a BriefingAgent run's output into a formatted,
 * cited .docx report. Reuses the same visual conventions (accent color,
 * h1/body helpers, US Letter page size) already established in the client
 * proposal generator, so all CodeCraft AI documents look consistent.
 *
 * Deliberately NOT a general markdown renderer - the synthesis prompt in
 * BriefingAgent.js asks the model to follow one simple, specific
 * convention (blank line between points; **Heading**: for any section
 * titles), and parseBriefBody below parses exactly that. Anything that
 * doesn't match the convention safely falls back to plain body text -
 * never throws, never drops content.
 */

const ACCENT = '1F4E5F';
const MUTED = '555555';
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'output', 'briefings');

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, bold: true, color: ACCENT, size: 28 })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text, size: 22, ...opts })],
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 22 })],
  });
}

function parseBriefBody(text) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      const headingMatch = block.match(/^\*\*(.+?)\*\*:?\s*(.*)$/s);
      if (headingMatch) {
        const [, heading, rest] = headingMatch;
        const headingPara = new Paragraph({
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: heading, bold: true, size: 24, color: ACCENT })],
        });
        return rest.trim() ? [headingPara, body(rest.trim())] : [headingPara];
      }
      return [body(block)];
    })
    .flat();
}

/**
 * @param {object} params
 * @param {string} params.goal - the original briefing request, used as the report title
 * @param {string} params.briefText - the final synthesized brief (inline citations already embedded by the model)
 * @param {Array<{title: string, url: string}>} params.sources - deduplicated sources actually used, for the appendix
 * @param {Date} [params.generatedAt]
 * @returns {Promise<string>} the absolute file path the report was saved to
 */
async function buildBriefingReport({ goal, briefText, sources = [], generatedAt = new Date(), outputDir = OUTPUT_DIR }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const dateStr = generatedAt.toISOString().slice(0, 10);

  const children = [
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: 'CodeCraft AI', bold: true, size: 36, color: ACCENT })],
    }),
    new Paragraph({
      spacing: { after: 400 },
      children: [new TextRun({ text: 'Briefing Report', size: 20, italics: true, color: MUTED })],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: goal, bold: true, size: 32 })],
    }),
    new Paragraph({
      spacing: { after: 320 },
      children: [new TextRun({ text: `Generated ${dateStr}`, size: 20, color: MUTED })],
    }),
    ...parseBriefBody(briefText),
    h1('Sources'),
    ...(sources.length > 0
      ? sources.map((s) => bullet(`${s.title} — ${s.url}`))
      : [body('No distinct source URLs were captured for this run.', { italics: true, color: '888888' })]),
  ];

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
        },
      ],
    },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 } } }, children }],
  });

  const safeGoal = goal.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 60) || 'briefing';
  const filename = `briefing-${safeGoal}-${dateStr}-${Date.now()}.docx`;
 const outputPath = path.join(outputDir, filename);

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

module.exports = { buildBriefingReport, parseBriefBody };