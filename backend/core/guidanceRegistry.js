const entries = new Map(); // skillId -> { name, content, triggers }

/**
 * GuidanceRegistry - holds installed "guidance" skills: reference text that
 * gets injected into an agent's system prompt when relevant, rather than
 * code that gets require()'d. Parallel in spirit to ToolRegistry, but for
 * skills that teach rather than skills that do.
 */
function register(skillId, { name, content, triggers = [] }) {
  if (!content || !content.trim()) {
    throw new Error(`Guidance skill "${skillId}" has no content to register`);
  }
  entries.set(skillId, { name: name || skillId, content, triggers });
}

function unregister(skillId) {
  return entries.delete(skillId);
}

function list() {
  return [...entries.entries()].map(([id, v]) => ({ id, ...v }));
}

/**
 * Guidance entries with no triggers are treated as always-relevant (global
 * guidance, e.g. a house style guide). Entries with triggers only match
 * when the given text contains one of their keywords - this is what stops
 * a large design-system doc from being stuffed into every unrelated prompt.
 */
function relevantGuidance(text) {
  if (!text) return list().filter((g) => !g.triggers.length);
  const lower = text.toLowerCase();
  return list().filter((g) => !g.triggers.length || g.triggers.some((t) => lower.includes(t.toLowerCase())));
}

/**
 * Formatted block ready to prepend to a system prompt, or '' if nothing
 * relevant is installed/enabled. Mirrors businessContextLine()'s shape.
 */
function guidanceLine(text) {
  const matches = relevantGuidance(text);
  if (!matches.length) return '';
  const blocks = matches.map((m) => `--- ${m.name} ---\n${m.content}`).join('\n\n');
  return `Relevant guidance from installed skills:\n${blocks}\n\n`;
}

module.exports = { register, unregister, list, relevantGuidance, guidanceLine };
