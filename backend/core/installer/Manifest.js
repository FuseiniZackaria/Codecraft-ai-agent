const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = ['id', 'name', 'version'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/; // npm-style: lowercase, hyphens, no spaces
const VALID_KINDS = ['tool', 'guidance'];

class ManifestError extends Error {}

/**
 * Manifest - loads and validates manifest.json for a skill package.
 * Single responsibility: shape/field validation only. Does not touch the
 * filesystem beyond reading the one file, does not check dependencies or
 * permissions against the running system (that's DependencyResolver /
 * PermissionManager's job).
 *
 * Two kinds of skill:
 *   "tool"     (default) - executable code, needs `entry`, becomes a
 *              callable tool/agent via Activator's require().
 *   "guidance" - reference text (e.g. a design-system doc), needs
 *              `guidanceFile`, gets injected into agent prompts instead
 *              of run as code. Never executed, so it carries no
 *              permissions and can't declare tools/events.
 */
class Manifest {
  static load(packageDir) {
    const manifestPath = path.join(packageDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      // A skill made with Claude (Agent Skills format): SKILL.md, no manifest.json.
      const skillMd = path.join(packageDir, 'SKILL.md');
      if (fs.existsSync(skillMd)) return Manifest.validate(Manifest.fromClaudeSkill(fs.readFileSync(skillMd, 'utf-8')));
      throw new ManifestError('manifest.json (or a Claude SKILL.md) not found in package root');
    }

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      throw new ManifestError(`manifest.json is not valid JSON: ${err.message}`);
    }

    return Manifest.validate(raw);
  }

  /**
   * Build a manifest from a Claude skill's SKILL.md header. It installs as a
   * "guidance" skill: its instructions are added to agent prompts when a task
   * mentions one of its trigger words. Scripts in the skill folder never run.
   *
   * Triggers: a `triggers` list in the header if there is one, otherwise the
   * words of the skill's name (e.g. "invoice-writer" -> "invoice", "writer").
   * Never empty - an empty list would add the skill to EVERY prompt.
   */
  static fromClaudeSkill(text) {
    const header = parseFrontmatter(text);
    if (!header) throw new ManifestError('SKILL.md has no header - it must start with --- name: ... description: ... ---');
    const rawName = String(header.name || '').trim();
    if (!rawName) throw new ManifestError('SKILL.md header is missing "name"');
    const id = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) throw new ManifestError(`SKILL.md name "${rawName}" has no letters or numbers`);
    const meta = header.metadata && typeof header.metadata === 'object' ? header.metadata : {};
    const listOf = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : [])
      .map((t) => String(t).trim()).filter(Boolean);
    let triggers = listOf(header.triggers).concat(listOf(meta.triggers));
    if (!triggers.length) {
      const GENERIC = new Set(['skill', 'skills', 'helper', 'tool', 'tools', 'the', 'and', 'for', 'with', 'claude']);
      const words = id.split('-').filter((w) => w.length >= 3 && !GENERIC.has(w));
      triggers = [...new Set([id.replace(/-/g, ' '), ...words])];
    }
    const version = String(header.version || meta.version || '1.0.0').trim();
    return {
      id,
      name: rawName.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
      version: /^\d+\.\d+\.\d+/.test(version) ? version : '1.0.0',
      author: String(header.author || meta.author || 'Claude skill'),
      description: String(header.description || '').trim(),
      kind: 'guidance',
      guidanceFile: 'SKILL.md',
      triggers,
      minimumCoreVersion: '1.0.0',
      dependencies: [],
      permissions: [],
      tools: [],
      events: ['skill.loaded', 'skill.enabled'],
      source: 'claude-skill',
    };
  }

  static validate(raw) {
    const missing = REQUIRED_FIELDS.filter((f) => !raw[f]);
    if (missing.length) {
      throw new ManifestError(`manifest.json is missing required field(s): ${missing.join(', ')}`);
    }
    if (!ID_PATTERN.test(raw.id)) {
      throw new ManifestError(
        `Invalid skill id "${raw.id}" - must be lowercase letters, numbers, and hyphens only`
      );
    }
    if (!/^\d+\.\d+\.\d+/.test(raw.version)) {
      throw new ManifestError(`Invalid version "${raw.version}" - expected semver (e.g. "1.0.0")`);
    }

    const kind = raw.kind || 'tool';
    if (!VALID_KINDS.includes(kind)) {
      throw new ManifestError(`Invalid kind "${raw.kind}" - must be one of: ${VALID_KINDS.join(', ')}`);
    }
    if (kind === 'tool' && !raw.entry) {
      throw new ManifestError('manifest.json is missing required field(s): entry (required when kind is "tool")');
    }
    if (kind === 'guidance' && !raw.guidanceFile) {
      throw new ManifestError(
        'manifest.json is missing required field(s): guidanceFile (required when kind is "guidance")'
      );
    }

    return {
      id: raw.id,
      name: raw.name,
      version: raw.version,
      author: raw.author || 'unknown',
      description: raw.description || '',
      kind,
      entry: raw.entry || null,
      guidanceFile: raw.guidanceFile || null,
      triggers: Array.isArray(raw.triggers) ? raw.triggers : [],
      minimumCoreVersion: raw.minimumCoreVersion || '0.0.0',
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
      permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
      tools: Array.isArray(raw.tools) ? raw.tools : [],
      events: Array.isArray(raw.events) ? raw.events : [],
    };
  }
}

/**
 * The YAML header between the first two "---" lines, kept simple: "key: value",
 * quoted values, "key: >" / "key: |" blocks, "[a, b]" and "- item" lists, and one
 * level of nesting (e.g. metadata:). Returns null when there is no header.
 */
function parseFrontmatter(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return null;
  const body = lines.slice(1, end);
  const unquote = (v) => {
    const t = v.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
    if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1).split(',').map((x) => unquote(x)).filter(Boolean);
    return t;
  };
  const indentOf = (l) => l.length - l.trimStart().length;

  function parseBlock(start, minIndent) {
    const out = {};
    let i = start;
    while (i < body.length) {
      const line = body[i];
      if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
      const indent = indentOf(line);
      if (indent < minIndent) break;
      const m = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!m) { i++; continue; }
      const [, key, rest] = m;
      i++;
      if (/^[>|][+-]?$/.test(rest)) {
        const parts = [];
        while (i < body.length && (!body[i].trim() || indentOf(body[i]) > indent)) { parts.push(body[i].trim()); i++; }
        out[key] = rest.startsWith('>') ? parts.filter(Boolean).join(' ') : parts.join('\n').trim();
      } else if (rest === '') {
        const next = body.slice(i).find((l) => l.trim());
        if (next && indentOf(next) > indent && next.trim().startsWith('- ')) {
          const items = [];
          while (i < body.length && (!body[i].trim() || (indentOf(body[i]) > indent && body[i].trim().startsWith('- ')))) {
            if (body[i].trim()) items.push(unquote(body[i].trim().slice(2)));
            i++;
          }
          out[key] = items;
        } else if (next && indentOf(next) > indent) {
          const nested = parseBlock(i, indentOf(next));
          out[key] = nested.value;
          i = nested.next;
        } else {
          out[key] = '';
        }
      } else {
        out[key] = unquote(rest);
      }
    }
    return { value: out, next: i };
  }
  return parseBlock(0, 0).value;
}

module.exports = { Manifest, ManifestError, parseFrontmatter };
