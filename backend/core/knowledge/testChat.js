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
    .filter((m) => !m.meta?.error && !(m.role === 'agent' && !m.body)) // held replies were never sent
    .map((m) => ({
      direction: m.role === 'customer' ? 'in' : 'out',
      body: m.role === 'customer'
        ? (m.meta?.seen ? require('../whatsapp/imageUnderstanding').asMessageText(m.meta.seen, m.body === '[photo]' ? '' : m.body) : m.body)
        : (m.meta?.customerSees ?? m.body),
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
  const products = (knowledgeUsed.products || []).map((x) => ({
    label: x.label, type: 'product', id: x.id, title: x.name,
    snippet: [x.category, x.stock_status && x.stock_status.replace('_', ' '), x.description].filter(Boolean).join(' - ').slice(0, 300),
    used: cited.has(x.label),
  }));
  return [...qa, ...docs, ...products];
}

function getAgent() {
  return require('../../agents/registry').getAgent('whatsapp');
}

/**
 * Send one test message. Returns { customer, agent } (the two saved rows).
 * The customer's message is saved even if the AI is unavailable.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A photo from the Test chat: { data (base64), mimetype }. Returns it checked, or null. */
function checkImage(image) {
  if (!image) return null;
  const mimetype = String(image.mimetype || '').toLowerCase();
  if (!/^image\/(jpeg|jpg|png|webp|gif)$/.test(mimetype)) throw fail('INVALID', 'Send a photo (JPG, PNG, WebP or GIF).');
  const data = String(image.data || '');
  const bytes = Math.floor((data.length * 3) / 4);
  if (!data || bytes < 10) throw fail('INVALID', 'That photo is empty.');
  if (bytes > MAX_IMAGE_BYTES) throw fail('INVALID', 'That photo is too big (max 5 MB).');
  return { data, mimetype };
}

/**
 * @param {string} text - what the "customer" wrote (optional with a photo: it's the caption)
 * @param {object} [image] - { data (base64), mimetype }: handled exactly like a WhatsApp photo
 */
async function send(workspaceId, text, user = {}, image = null) {
  const caption = typeof text === 'string' ? text.trim() : '';
  const photo = checkImage(image);
  if (!caption && !photo) throw fail('INVALID', 'Type a message first.');
  if (caption.length > MAX_TEXT) throw fail('INVALID', `That message is too long (max ${MAX_TEXT} characters).`);
  checkRate(workspaceId);

  const before = await store.listTestMessages(workspaceId, 12);

  // A photo is looked at first (same as on WhatsApp). If the AI can't read it, say so.
  let seen = null;
  if (photo) {
    try {
      seen = await require('../whatsapp/imageUnderstanding').describe(photo);
    } catch (err) {
      const customerRow = await store.addTestMessage(workspaceId, { role: 'customer', body: caption || '[photo]', meta: { photo: true }, userId: user.id || null });
      const agentRow = await store.addTestMessage(workspaceId, {
        role: 'agent', body: '', userId: user.id || null,
        meta: { error: `The AI couldn't look at the photo (${err.message}). On WhatsApp you'd get an alert to attend to this customer.` },
      });
      return { customer: customerRow, agent: agentRow };
    }
  }
  const imageUnderstanding = require('../whatsapp/imageUnderstanding');
  const body = seen ? imageUnderstanding.asMessageText(seen, caption) : caption;
  const customer = await store.addTestMessage(workspaceId, {
    role: 'customer',
    body: caption || '[photo]',
    meta: seen ? { photo: true, seen: { kind: seen.kind, description: seen.description, text: seen.text, searchTerms: seen.searchTerms } } : {},
    userId: user.id || null,
  });

  const profile = await businessProfile.getProfile(workspaceId).catch(() => null);
  const v = await agentSettings.forAgent(workspaceId, profile);
  const agent = getAgent();

  let drafted;
  try {
    drafted = await agent.draftReply({
      body, history: toHistory(before), workspaceId, v, profile, now: new Date(),
      ...(seen ? { photoTerms: seen.searchTerms, paymentPhoto: seen.payment } : {}),
    });
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
    // Same text a real customer would get (payments have their own "we'll confirm" message).
    // Held: the customer gets nothing until you reply or approve (no "checking with the team").
    customerSees: held ? null : drafted.reply,
    kind: drafted.kind || null,
    sources: describeSources(drafted.knowledgeUsed),
    cited: drafted.knowledgeUsed?.cited || [],
    // Product photos a real customer would also get (only when the reply is sent straight away).
    photos: held ? [] : (drafted.photos || []).map((x) => ({ name: x.name, image_url: x.image_url || null, product_url: x.product_url || null })),
    instructionsVersion: v.version,
    instructionsSource: v.source,
    autoReplyOn,
  };
  const agentRow = await store.addTestMessage(workspaceId, { role: 'agent', body: meta.customerSees || '', meta, userId: user.id || null });
  return { customer, agent: agentRow };
}

module.exports = { send, toHistory, describeSources, HOURLY_LIMIT, MAX_TEXT, _sentLog: sentLog };
