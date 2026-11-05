const config = require('../../config');
const store = require('./store');
const voice = require('../whatsapp/voice');

/**
 * The WhatsApp agent's instructions, example replies and hold reply for one
 * workspace - edited on Settings -> General -> Agent instructions, with every
 * save kept as a version.
 *
 * Which text is used, in order:
 *   1. the newest saved version for the workspace;
 *   2. no saved version yet: a neutral starting template (below), filled in
 *      with the agent's name and the business name from the profile;
 *   3. no workspace, or migration 0006 not run yet: the old
 *      backend/config/whatsapp-voice.md file, exactly as before.
 *
 * Changes apply on the agent's next reply: saving clears the cache, and the
 * cache only lives 15 seconds anyway.
 *
 * {{agent_name}} and {{business_name}} in the text are filled in at reply time.
 */

const CACHE_MS = 15 * 1000;
const cache = new Map(); // workspaceId -> { at, settings }

const LIMITS = { instructions: 20000, agentName: 40, holdReply: 500, examples: 30, exampleText: 1000, note: 200 };

const DEFAULT_HOLD = voice.FALLBACK_TEXTS.hold;

const DEFAULT_INSTRUCTIONS = `## Who you are
- You are {{agent_name}}, the WhatsApp assistant for {{business_name}}. When it fits, introduce yourself as "{{agent_name}} from {{business_name}}".
- You are not the owner or a staff member, and you never use any other personal name - only "{{agent_name}}".
- If someone asks whether you're a bot, an AI or a real person, be honest: you're {{business_name}}'s AI assistant, and the team can step in whenever they'd like.

## Tone
- Friendly, polite and professional, the way a helpful person chats on WhatsApp.
- Short: usually 1-3 sentences. No walls of text and no sales jargon.
- Greet by the time of day when a conversation starts (the right greeting is given to you below). Don't greet again mid-conversation.
- At most ONE question per message. Emojis rare.
- No signature or sign-off at the end - it's a chat, not an email.

## What to say
- Answer what they actually asked.
- Facts about the business - prices, services, opening hours, contact details, policies - come ONLY from the business knowledge you are given. Never invent them.
- If the answer isn't in that knowledge, don't guess: say a team member will follow up, and set "hold" to true.

## When to hold for the team
Set "hold" to true (your reply then waits for the team as a suggestion) when the message is about:
- pricing, costs or a quote
- agreeing to a deal, a contract or an order
- a deadline, a delivery date or any promise
- a complaint, or the customer is upset or angry
- something you don't know the answer to
Everything else - greetings, thanks, general questions - is answered straight away (hold = false).

## Email & outreach tone
- Professional, friendly and direct. Clear, simple English. One clear benefit per message.`;

function invalidate(workspaceId) {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

function fromFile() {
  const v = voice.loadVoice();
  return {
    source: 'file', version: null, versionId: null,
    agentName: config.assistant.name || 'Ian',
    instructions: v.instructions, examples: [], holdReply: v.hold || DEFAULT_HOLD,
  };
}

function defaults() {
  return {
    source: 'default', version: null, versionId: null,
    agentName: config.assistant.name || 'Ian',
    instructions: DEFAULT_INSTRUCTIONS, examples: [], holdReply: DEFAULT_HOLD,
  };
}

function fromRow(row) {
  return {
    source: 'saved', version: row.version, versionId: row.id,
    agentName: row.agent_name || config.assistant.name || 'Ian',
    instructions: row.instructions,
    examples: Array.isArray(row.examples) ? row.examples : [],
    holdReply: row.hold_reply || DEFAULT_HOLD,
    note: row.note || null, createdAt: row.created_at, createdByEmail: row.created_by_email || null,
  };
}

let warnedMissing = false;

/** The settings in use for this workspace (raw text, placeholders not filled in). */
async function getActive(workspaceId) {
  if (!workspaceId) return fromFile();
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;
  let settings;
  try {
    const row = await store.getLatestVersion(workspaceId);
    settings = row ? fromRow(row) : defaults();
  } catch (err) {
    if (err.code === 'MIGRATION_MISSING') {
      if (!warnedMissing) console.warn(`[agentSettings] ${err.message} Using whatsapp-voice.md until then.`);
      warnedMissing = true;
    } else {
      console.warn(`[agentSettings] couldn't load settings for ${workspaceId} (${err.message}) - using whatsapp-voice.md`);
    }
    return fromFile(); // not cached, so it recovers as soon as the database is back
  }
  cache.set(workspaceId, { at: Date.now(), settings });
  return settings;
}

/** Fill in {{agent_name}} / {{business_name}} and drop <!-- notes -->. */
function render(text, { agentName, businessName }) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{\s*agent_name\s*\}\}/gi, agentName || 'Ian')
    .replace(/\{\{\s*business_name\s*\}\}/gi, businessName || 'our business')
    .trim();
}

/**
 * Everything the WhatsApp agent needs, ready for the prompt.
 * @returns {{agentName, instructions, examplesBlock, holdReply, version, source}}
 */
async function forAgent(workspaceId, profile = null) {
  const s = await getActive(workspaceId);
  const names = { agentName: s.agentName, businessName: profile?.business_name || null };
  const examples = s.examples
    .filter((e) => e && e.customer && e.reply)
    .map((e) => `Customer: ${render(e.customer, names)}\n${s.agentName}: ${render(e.reply, names)}`);
  return {
    agentName: s.agentName,
    instructions: render(s.instructions, names),
    examplesBlock: examples.length ? `Example replies (match this style, not these exact words):\n\n${examples.join('\n\n')}` : '',
    holdReply: render(s.holdReply, names) || DEFAULT_HOLD,
    version: s.version,
    source: s.source,
  };
}

/**
 * The "Email & outreach tone" section of the instructions (any "## ..." heading
 * mentioning email or outreach and tone), for the email/outreach agents.
 * Returns null if there's no such section.
 */
async function emailTone(workspaceId) {
  if (!workspaceId) return null;
  const s = await getActive(workspaceId);
  if (s.source === 'file') return null;
  const text = String(s.instructions || '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const sections = text.split(/\n(?=##\s)/);
  for (const sec of sections) {
    const m = sec.match(/^##\s+(.+)\n?([\s\S]*)$/);
    if (m && /tone/i.test(m[1]) && /(email|outreach)/i.test(m[1]) && m[2].trim()) return m[2].trim();
  }
  return null;
}

/** Checks what the form sent. Returns { value, errors }. */
function validate(input = {}) {
  const errors = [];
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const agentName = str(input.agent_name) || config.assistant.name || 'Ian';
  const instructions = str(input.instructions);
  const holdReply = str(input.hold_reply);
  const note = str(input.note);

  if (!instructions) errors.push('The instructions can\'t be empty.');
  if (instructions.length > LIMITS.instructions) errors.push(`The instructions are too long (max ${LIMITS.instructions} characters).`);
  if (agentName.length > LIMITS.agentName) errors.push(`The agent name is too long (max ${LIMITS.agentName} characters).`);
  if (holdReply.length > LIMITS.holdReply) errors.push(`The "team will follow up" message is too long (max ${LIMITS.holdReply} characters).`);
  if (note.length > LIMITS.note) errors.push(`The note is too long (max ${LIMITS.note} characters).`);

  const examples = [];
  if (input.examples !== undefined && !Array.isArray(input.examples)) errors.push('Example replies must be a list.');
  for (const [i, e] of (Array.isArray(input.examples) ? input.examples : []).entries()) {
    const customer = str(e?.customer);
    const reply = str(e?.reply);
    if (!customer && !reply) continue; // blank row - ignore
    if (!customer || !reply) { errors.push(`Example ${i + 1} needs both the customer's message and the reply.`); continue; }
    if (customer.length > LIMITS.exampleText || reply.length > LIMITS.exampleText) {
      errors.push(`Example ${i + 1} is too long (max ${LIMITS.exampleText} characters each).`);
      continue;
    }
    examples.push({ customer, reply });
  }
  if (examples.length > LIMITS.examples) errors.push(`Too many example replies (max ${LIMITS.examples}).`);

  return { value: { agent_name: agentName, instructions, examples, hold_reply: holdReply || null, note: note || null }, errors };
}

async function save(workspaceId, input, user = {}) {
  const { value, errors } = validate(input);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.code = 'INVALID';
    err.details = errors;
    throw err;
  }
  const row = await store.addVersion(workspaceId, { ...value, created_by: user.id || null, created_by_email: user.email || null });
  invalidate(workspaceId);
  return row;
}

/** Roll back = save an old version again as the newest one (history is never rewritten). */
async function restore(workspaceId, versionId, user = {}) {
  const old = await store.getVersion(workspaceId, versionId);
  if (!old) {
    const err = new Error('That version was not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const row = await store.addVersion(workspaceId, {
    agent_name: old.agent_name, instructions: old.instructions, examples: old.examples, hold_reply: old.hold_reply,
    note: `Rolled back to version ${old.version}`,
    created_by: user.id || null, created_by_email: user.email || null,
  });
  invalidate(workspaceId);
  return row;
}

module.exports = {
  getActive, forAgent, emailTone, validate, save, restore, invalidate, render,
  DEFAULT_INSTRUCTIONS, DEFAULT_HOLD, LIMITS,
};
