const store = require('./store');

/**
 * Q&A entries (Settings -> General -> Q&A): question/answer pairs the owner
 * writes (or saves from "Correct this answer"), each with an on/off switch.
 * Switched-off entries are never shown to the agent.
 */

const LIMITS = { question: 500, answer: 4000, entries: store.QA_MAX_LIST };

function invalid(errors) {
  const err = new Error(errors.join(' '));
  err.code = 'INVALID';
  err.details = errors;
  return err;
}

/** Checks a new entry or a change. partial: only the fields present are checked. */
function validate(input = {}, { partial = false } = {}) {
  const errors = [];
  const value = {};
  for (const key of ['question', 'answer']) {
    if (partial && input[key] === undefined) continue;
    const text = typeof input[key] === 'string' ? input[key].trim() : '';
    const label = key === 'question' ? 'The question' : 'The answer';
    if (!text) errors.push(`${label} can't be empty.`);
    else if (text.length > LIMITS[key]) errors.push(`${label} is too long (max ${LIMITS[key]} characters).`);
    else value[key] = text;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') errors.push('"enabled" must be true or false.');
    else value.enabled = input.enabled;
  }
  return { value, errors };
}

async function create(workspaceId, input, user = {}, { source = 'manual', sourceMessageId = null } = {}) {
  const { value, errors } = validate(input);
  if (errors.length) throw invalid(errors);
  if ((await store.countQa(workspaceId)) >= LIMITS.entries) {
    throw invalid([`You've reached the limit of ${LIMITS.entries} Q&A entries - delete or merge some first.`]);
  }
  return store.createQa(workspaceId, {
    ...value, enabled: value.enabled !== false, source, source_message_id: sourceMessageId, created_by: user.id || null,
  });
}

async function update(workspaceId, id, input) {
  const { value, errors } = validate(input, { partial: true });
  if (errors.length) throw invalid(errors);
  if (!Object.keys(value).length) throw invalid(['Nothing to change.']);
  const saved = await store.updateQa(workspaceId, id, value);
  if (!saved) {
    const err = new Error('That Q&A entry was not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return saved;
}

async function remove(workspaceId, id) {
  if (!(await store.deleteQa(workspaceId, id))) {
    const err = new Error('That Q&A entry was not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
}

/**
 * "Correct this answer": save the right answer to an agent reply as a Q&A
 * entry, so the agent uses it from its next reply.
 *
 * kind: 'test' (a Test chat reply) or 'whatsapp' (a real reply in the Inbox).
 * The message must be an agent reply this person may see. Correcting the same
 * reply again updates that entry (and switches it back on) instead of adding
 * a duplicate. Returns { entry, created }.
 */
async function correct(workspaceId, { kind, messageId, question, answer } = {}, user = {}) {
  if (!['test', 'whatsapp'].includes(kind) || typeof messageId !== 'string' || !messageId) {
    throw invalid(['Which reply are you correcting? (kind must be "test" or "whatsapp", plus the message id)']);
  }
  let ok = false;
  if (kind === 'test') {
    const m = await store.getTestMessage(workspaceId, messageId);
    ok = !!m && m.role === 'agent';
  } else {
    const wa = require('../whatsapp/store');
    const m = await wa.getMessage({ userId: user.id || null, workspaceId }, messageId);
    ok = !!m && m.direction === 'out';
  }
  if (!ok) {
    const err = new Error("That reply wasn't found (or it isn't one of the agent's replies).");
    err.code = 'NOT_FOUND';
    throw err;
  }

  const sourceId = `${kind}:${messageId}`;
  const existing = await store.findQaBySource(workspaceId, sourceId);
  if (existing) {
    const entry = await update(workspaceId, existing.id, { question, answer, enabled: true });
    return { entry, created: false };
  }
  const entry = await create(workspaceId, { question, answer }, user, { source: 'correction', sourceMessageId: sourceId });
  return { entry, created: true };
}

/** { "test:<id>": qaEntryId, "whatsapp:<id>": ... } for showing "Corrected" on replies. */
async function corrections(workspaceId) {
  const out = {};
  for (const c of await store.listCorrections(workspaceId)) out[c.source_message_id] = c.id;
  return out;
}

module.exports = { create, update, remove, validate, correct, corrections, LIMITS };
