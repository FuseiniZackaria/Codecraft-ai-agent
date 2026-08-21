const BaseAgent = require('../base/BaseAgent');
const memory = require('../../memory');
const activityLog = require('../../core/activityLog');
const { selectProvider } = require('../../core/router');
const toolRegistry = require('../../tools/ToolRegistry');
const { businessContextLine } = require('../../core/businessContext');
const config = require('../../config');

const MAX_FILES = 20; // keep generation time/cost sane for a single request

const DESIGN_GUIDANCE =
  `Design like a studio known for giving every client a visual identity that couldn't be mistaken for ` +
  `anyone else's - not a templated default. Ground every choice in the actual subject (its audience, ` +
  `its own materials/vernacular), not a generic "business website" look.\n\n` +
  `AVOID these three defaults that AI-generated sites cluster around unless the request specifically ` +
  `asks for one: (1) cream background + high-contrast serif + terracotta/warm-clay accent, ` +
  `(2) near-black background + single neon/acid accent, (3) broadsheet newspaper columns with hairline ` +
  `rules and zero border-radius. Pick something specific to THIS subject instead.\n\n` +
  `Typography carries the personality - pair a characterful display face with a complementary body face ` +
  `(real Google Fonts, loaded via <link> tags, never just system-ui/Arial/Times). Use a real 4-6 color ` +
  `named hex palette with intention, not default blue links on white. Give the page one genuine ` +
  `signature moment it'll be remembered by - spend the boldness there, keep everything else disciplined. ` +
  `Only use numbered markers (01/02/03) if the content is a genuine sequence, not as decoration. Real, ` +
  `specific copy grounded in the actual subject - never lorem ipsum or generic placeholder text. Must be ` +
  `responsive down to mobile and have visible keyboard focus states.`;

function slugify(text) {
  return (text || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
}

function stripCodeFences(text) {
  const fenced = text.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : text.trim();
}

/**
 * Deterministically guarantees an HTML file actually links its sibling
 * CSS/JS files by their exact real filenames - rather than hoping the model
 * remembered to. Each file is generated in an isolated LLM call that only
 * sees a list of sibling filenames, not their content; the model can and
 * did skip the <link>/<script> tag entirely, or use a slightly wrong
 * filename, producing a page that looks completely unstyled even though a
 * real, correct CSS file exists right next to it on disk.
 */
function ensureAssetLinks(htmlContent, siblingPaths) {
  let html = htmlContent;

  for (const file of siblingPaths) {
    if (file.endsWith('.css')) {
      const alreadyLinked = new RegExp(`href=["']\\.?/?${escapeRegex(file)}["']`, 'i').test(html);
      if (!alreadyLinked) {
        const tag = `  <link rel="stylesheet" href="${file}">\n`;
        html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tag}</head>`) : `${tag}${html}`;
      }
    }
    if (file.endsWith('.js')) {
      const alreadyLinked = new RegExp(`src=["']\\.?/?${escapeRegex(file)}["']`, 'i').test(html);
      if (!alreadyLinked) {
        const tag = `  <script src="${file}"></script>\n`;
        html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : `${html}\n${tag}`;
      }
    }
  }

  return html;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * CodingAgent - builds real websites and small systems: plans a file list,
 * generates working code for each file, writes it into a sandboxed
 * workspace (never anywhere else on disk - see plugins/filesystem), then
 * zips the result for download. Nothing here touches GitHub or sends
 * anything externally - it only produces local files, so it doesn't need
 * the approval gate the way email/GitHub-push actions do.
 *
 * Deliberately scoped: single-request generation of up to MAX_FILES files,
 * not an iterative build-test-fix loop. Good for landing pages, small
 * multi-file apps, and scaffolds - not a replacement for a real dev
 * environment with test execution and debugging.
 */
class CodingAgent extends BaseAgent {
  constructor() {
    super({
      key: 'coding',
      role: 'Coding Agent',
      goals: ['Build real, working websites and small systems from a plain-language request'],
      tools: ['filesystem.writeFile', 'filesystem.listFiles', 'filesystem.zipProject'],
    });
  }

  async plan(task) {
    const provider = selectProvider(task);
    const schemaInstruction =
      `Respond with ONLY a JSON object, nothing else - no markdown fences, no explanation before or ` +
      `after, just the raw JSON starting with { and ending with }:\n` +
      `{"projectName": "short-name", "summary": "one sentence", ` +
      `"design": {"palette": [{"name": "...", "hex": "#..."}, ...4-6 colors], ` +
      `"typography": {"display": "Google Font name", "body": "Google Font name"}, ` +
      `"layoutConcept": "one sentence describing the layout approach", ` +
      `"signature": "the one memorable element this design is built around"}, ` +
      `"files": [{"path": "index.html", "description": "what this file does and its key contents"}]}`;

    const plan = await this._planWithRetry(provider, task, schemaInstruction);

    if (!plan?.files?.length) {
      throw new Error('Could not plan a file structure for that request - try being more specific about what to build.');
    }

    const files = plan.files.slice(0, MAX_FILES);
    task.workspaceId = `${slugify(plan.projectName)}-${task.id.slice(0, 8)}`;
    task.projectSummary = plan.summary || task.instruction;
    task.plannedFiles = files.map((f) => f.path);
    task.designBrief = plan.design || null;

    await activityLog.record(this.role, 'plan_created', task.workspaceId, {
      taskId: task.id,
      fileCount: files.length,
      hasDesignBrief: !!task.designBrief,
    });

    // Live narration: pushed through the same event bus the Console page
    // already streams from, but as human-readable text a person would
    // actually want to read while waiting, not a technical log line - the
    // Tasks page listens for these and shows them in place of a static
    // "running" state.
    const designNote = plan.design
      ? ` Going with a ${plan.design.palette?.slice(0, 3).map((c) => c.name).join('/')} palette and "${plan.design.signature}" as the signature moment.`
      : '';
    await activityLog.record(this.role, 'narration', task.workspaceId, {
      taskId: task.id,
      text: `Planned it out: ${plan.summary || task.instruction}${designNote} Building ${files.length} file${files.length === 1 ? '' : 's'} now.`,
    });

    return files.map((f) => ({ type: 'generate_and_write', path: f.path, description: f.description }));
  }

  async _planWithRetry(provider, task, schemaInstruction) {
    // Second attempt gets a meaningfully larger budget, not the same one
    // that just truncated - retrying with an identical constraint that
    // already failed would just fail the same way again.
    const tokenBudgets = [3500, 6000];

    for (let attempt = 0; attempt < tokenBudgets.length; attempt++) {
      const strictness =
        attempt === 0
          ? ''
          : '\n\nIMPORTANT: your previous response did not fit - keep file descriptions to a short phrase ' +
            '(not a paragraph) so the whole response fits, and output ONLY the JSON object, nothing else.';

      const manifestResult = await provider.complete({
        maxTokens: tokenBudgets[attempt],
        system:
          `${businessContextLine()}You are a software architect AND design lead planning a minimal, ` +
          `working build for the request below. Choose the simplest stack that satisfies it (plain ` +
          `HTML/CSS/JS for a static site; React+Vite only if real interactivity/state is genuinely ` +
          `needed; a tiny Node/Express server only if a real backend is needed). Cap it at ${MAX_FILES} ` +
          `files - prefer fewer, complete files over many stub files. Keep each file's "description" to ` +
          `one short phrase, not a paragraph - full detail belongs in the generated code, not the plan.` +
          `\n\n${DESIGN_GUIDANCE}\n\n${schemaInstruction}${strictness}`,
        prompt: task.instruction,
      });

      if (manifestResult.truncated) {
        console.warn(`[CodingAgent] build plan truncated at maxTokens=${tokenBudgets[attempt]} - retrying with a larger budget`);
        continue;
      }

      try {
        const match = manifestResult.text.match(/\{[\s\S]*\}/);
        if (!match) {
          console.warn(`[CodingAgent] no JSON object found in plan response (attempt ${attempt + 1}): ${manifestResult.text.slice(0, 300)}`);
          continue;
        }
        return JSON.parse(match[0]);
      } catch (err) {
        console.warn(`[CodingAgent] failed to parse build plan (attempt ${attempt + 1}): ${err.message} - raw: ${manifestResult.text.slice(0, 300)}`);
      }
    }
    return null;
  }

  async _generateFileContent(provider, task, step, designLine) {
    const tokenBudgets = [4000, 7000, 14000];

    for (let attempt = 0; attempt < tokenBudgets.length; attempt++) {
      const brevityHint =
        attempt === 0
          ? ''
          : `\n\nIMPORTANT: the previous attempt didn't fit. Make it more compact WITHOUT losing quality: ` +
            `use CSS custom properties (variables) for repeated colors/spacing instead of repeating literal ` +
            `values, combine related selectors, avoid verbose comments and redundant rules. This genuinely ` +
            `produces better CSS, not just shorter CSS.`;

      const result = await provider.complete({
        maxTokens: tokenBudgets[attempt],
        system:
          `${businessContextLine()}You are the Coding Agent inside CodeCraft AI, writing one file of a real, ` +
          `working project. Write complete, correct, production-quality code - no TODOs, no placeholders, ` +
          `no "implement this later".${designLine}\n\n${DESIGN_GUIDANCE}\n\n` +
          `Respond with ONLY the raw file content - no markdown code fences, no explanation before or after.${brevityHint}`,
        prompt:
          `Project: ${task.projectSummary}\n\n` +
          `All files in this project: ${task.plannedFiles.join(', ')}\n` +
          `If this file is HTML and any of those other files are .css or .js, you MUST reference them by ` +
          `their EXACT filename above - a <link rel="stylesheet" href="exact-name.css"> in <head>, and/or ` +
          `<script src="exact-name.js"> before </body>. A stylesheet that isn't linked never applies.\n\n` +
          `Now write the complete content for this specific file:\nPath: ${step.path}\nPurpose: ${step.description}`,
      });

      if (result.truncated) {
        console.warn(`[CodingAgent] ${step.path} truncated at maxTokens=${tokenBudgets[attempt]} - retrying with a larger budget`);
        continue;
      }

      return stripCodeFences(result.text);
    }

    // Never silently write a broken, cut-off file - a clear failure here is
    // far better than a half-written HTML/CSS/JS file landing in the project.
    throw new Error(`Could not generate ${step.path} within the token budget - the request may be too large for one file.`);
  }

  async execute(step, task) {
    if (step.type !== 'generate_and_write') {
      return super.execute(step, task);
    }

    await activityLog.record(this.role, 'step_started', step.path, { taskId: task.id, stepType: 'generate_and_write' });
    await activityLog.record(this.role, 'narration', step.path, {
      taskId: task.id,
      text: `Writing ${step.path} — ${step.description}`,
    });

    const designLine = task.designBrief
      ? `\n\nDesign brief for this project (apply consistently across every file):\n` +
        `Palette: ${task.designBrief.palette?.map((c) => `${c.name} ${c.hex}`).join(', ')}\n` +
        `Typography: display "${task.designBrief.typography?.display}", body "${task.designBrief.typography?.body}"\n` +
        `Layout: ${task.designBrief.layoutConcept}\n` +
        `Signature element: ${task.designBrief.signature}\n`
      : '';

    const provider = selectProvider(task);
    let content = await this._generateFileContent(provider, task, step, designLine);

    if (step.path.endsWith('.html')) {
      const siblings = task.plannedFiles.filter((f) => f !== step.path);
      content = ensureAssetLinks(content, siblings);
    }

    const writeResult = await toolRegistry.call(
      'filesystem.writeFile',
      { projectId: task.workspaceId, path: step.path, content },
      { role: this.role }
    );

    await activityLog.record(this.role, 'tool_call', 'filesystem.writeFile', {
      taskId: task.id,
      path: step.path,
      bytes: writeResult.bytes,
      status: 'done',
    });

    return { path: step.path, bytes: writeResult.bytes };
  }

  async reflect(task, results) {
    const zipResult = await toolRegistry.call('filesystem.zipProject', { projectId: task.workspaceId }, { role: this.role });

    const downloadUrl = `http://localhost:${config.port}/api/workspace/${task.workspaceId}/download`;
    const note =
      `Built "${task.projectSummary}" — ${results.length} file(s) written:\n` +
      task.plannedFiles.map((f) => `  - ${f}`).join('\n') +
      `\n\nDownload: ${downloadUrl}`;

    await memory.addReflection(this.role, task.id, note);
    await activityLog.record(this.role, 'skill.built', task.workspaceId, { taskId: task.id, fileCount: results.length });
    await activityLog.record(this.role, 'narration', task.workspaceId, {
      taskId: task.id,
      text: `Done — all ${results.length} file${results.length === 1 ? '' : 's'} written and zipped. Ready to download.`,
    });

    // BaseAgent.run() returns the `results` array by reference, not
    // reflect()'s own return value - push a text-bearing entry here so the
    // existing "find last step with .text" pattern in chat.js surfaces this
    // summary, same as Research/Marketing/CEO already do.
    results.push({ text: note, workspaceId: task.workspaceId, zipPath: zipResult.zipPath });

    return note;
  }
}

module.exports = CodingAgent;
