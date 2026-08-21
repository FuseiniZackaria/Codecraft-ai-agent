// IMPORTANT SAFETY BOUNDARY: this module turns a page's own text into
// reference guidance for agents to read - it NEVER installs, runs, or
// executes the CLI command itself. Auto-running a command scraped from an
// arbitrary website would mean letting web content trigger real code
// execution on the user's machine, which this deliberately does not do,
// no matter how it's framed. The output here is always kind:"guidance" -
// never kind:"tool" - so there is no entry point for it to run as code.

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const MAX_GUIDANCE_CHARS = 8000; // real page text can be huge - cap it, same tradeoff already flagged for ui-ux-pro-max

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'imported-skill';
}

function stripTagsAndDecode(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(html, fallback) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : fallback;
}

/**
 * Fetches the real page and builds a manifest + guidance content from its
 * actual text - not a stub, not a template filled with placeholder text.
 */
async function buildSkillFromPage(url, detectedCommand) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch the page (HTTP ${res.status})`);
  const html = await res.text();

  const origin = new URL(url).hostname;
  const title = extractTitle(html, origin);
  const id = slugify(title) || slugify(origin);

  let guidanceText = stripTagsAndDecode(html);
  if (guidanceText.length > MAX_GUIDANCE_CHARS) guidanceText = guidanceText.slice(0, MAX_GUIDANCE_CHARS) + '\n\n[...truncated]';

  const commandWords = (detectedCommand || '').split(/\s+/).filter((w) => w.length > 2 && !['npx', 'npm', 'install', 'pip', 'pip3', 'cargo', 'go', 'brew', 'yarn', 'global', 'add', '-g'].includes(w));

  const manifest = {
    id,
    name: title,
    version: '1.0.0',
    author: 'auto-imported',
    description: `Reference guidance auto-imported from ${url}. Not verified, not reviewed - a page's own text, saved for agents to consult.`,
    kind: 'guidance',
    guidanceFile: 'guidance.md',
    triggers: commandWords.length ? commandWords : [],
    minimumCoreVersion: '1.0.0',
    dependencies: [],
    permissions: [],
    tools: [],
    events: ['skill.loaded', 'skill.enabled'],
  };

  const guidanceContent = `# ${title}\n\nAuto-imported from ${url}\n\n${detectedCommand ? `A CLI command was spotted on this page (not verified, not run):\n\`${detectedCommand}\`\n\n---\n\n` : ''}${guidanceText}\n`;

  return { manifest, guidanceContent };
}

/**
 * Writes the generated package to a real temp directory, ready to be
 * handed to the existing Installer - reusing the exact same install
 * pipeline every other skill in this project goes through, not a
 * shortcut around it.
 */
function writePackageToTempDir(manifest, guidanceContent) {
  const dir = path.join(os.tmpdir(), `cc-cli-import-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, 'guidance.md'), guidanceContent);
  return dir;
}

module.exports = { buildSkillFromPage, writePackageToTempDir, slugify };
