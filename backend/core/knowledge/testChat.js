const config = require('../../config');
const store = require('./store');
const agentSettings = require('./agentSettings');
const businessProfile = require('../businessProfile');

/**
 * Test chat (Settings -> General -> Test chat): message the WhatsApp agent as
 * if you were a customer and see exactly how it would reply with the current
 * instructions, Q&A and documents - before any real customer does.
 *
 * It runs the real agent's drafting and safety checks (WhatsAppAgent.draftReply
 * + replyPolicy), but NEVER sends anything to anyone and never alerts you.
 *
 * For every reply it records:
 *   - what a real customer would see (the reply, or the "check with the team"
 *     message if it would be held), and Ian's suggested answer;
 *   - whether it would be sent straight away or held for your approval, and why;
 *   - which Q&A entries and document parts it was given, and which it used.
 */

const MAX_TEXT = 2000;
const HOURLY_LIMIT = 60; // each test message is a real (paid) AI call
const sentLog = new Map(); // workspaceId -> [timestamps]

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function checkRate(workspaceId) {
  const now = Date.now();
  const recent = (sentLog.get(workspaceId) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= HOURLY_LIMIT) {
    throw fail('RATE_LIMIT', `That's ${HOURLY_LIMIT} test messages in the last hour - please wait a little (each one is a real AI call).`);
  }
  recent.push(now);
  sentLog.set(workspaceId, recent);
}

/** Test-chat rows -> the history shape the agent uses (what the customer actually saw). */
function toHistory(rows) {
  return rows
    .filter((m) => !m.meta?.error)
    .map((m) => ({
      direction: m.role === 'customer' ? 'in' : 'out',
      body: m.role === 'customer' ? m.body : (m.meta?.customerSees ?? m.body),
      sent_at: m.created_at,
    }));
}

/** What the agent was given, with a flag for what it says it used. */
function describeSources(knowledgeUsed = {}) {
  const cited = new Set(knowledgeUsed.cited || []);
  const qa = (knowledgeUsed.qa || []).map((e) => ({
    label: e.label, type: 'qa', id: e.id, title: e.question, snippet: e.answer.slice(0, 300), used: cited.has(e.label),
  }));
  const docs = (knowledgeUsed.docs || []).map((d) => ({
    label: d.label, type: 'doc', id: d.documentId, title: d.filename, section: d.chunkIndex + 1,
    snippet: d.content.slice(0, 300), used: cited.has(d.label),
  }));
  return [...qa, ...docs];
}

function getAgent() {
  return require('../../agents/registry').getAgent('whatsapp');
}

/**
 * Send one test message. Returns { customer, agent } (the two saved rows).
 * The customer's message is saved even if the AI is unavailable.
 */
async function send(workspaceId, text, user = {}) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) throw fail('INVALID', 'Type a message first.');
  if (body.length > MAX_TEXT) throw fail('INVALID', `That message is too long (max ${MAX_TEXT} characters).`);
  checkRate(workspaceId);

  const before = await store.listTestMessages(workspaceId, 12);
  const customer = await store.addTestMessage(workspaceId, { role: 'customer', body, userId: user.id || null });

  const profile = await businessProfile.getProfile(workspaceId).catch(() => null);
  const v = await agentSettings.forAgent(workspaceId, profile);
  const agent = getAgent();

  let drafted;
  try {
    drafted = await agent.draftReply({ body, history: toHistory(before), workspaceId, v, profile, now: new Date() });
  } catch (err) {
    const agentRow = await store.addTestMessage(workspaceId, {
      role: 'agent', body: '', userId: user.id || null,
      meta: { error: `The AI couldn't answer (${err.message}). A real customer's message would wait and you'd get an alert.` },
    });
    return { customer, agent: agentRow };
  }

  const held = !!drafted.hold;
  const autoReplyOn = !!config.whatsapp.autoReply;
  const meta = {
    draft: drafted.reply,
    held,
    reason: drafted.reason,
    customerSees: held ? v.holdReply : drafted.reply,
    sources: describeSources(drafted.knowledgeUsed),
    cited: drafted.knowledgeUsed?.cited || [],
    instructionsVersion: v.version,
    instructionsSource: v.source,
    autoReplyOn,
  };
  const agentRow = await store.addTestMessage(workspaceId, { role: 'agent', body: meta.customerSees, meta, userId: user.id || null });
  return { customer, agent: agentRow };
}

module.exports = { send, toHistory, describeSources, HOURLY_LIMIT, MAX_TEXT, _sentLog: sentLog };
