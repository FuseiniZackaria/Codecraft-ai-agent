const { selectProvider } = require('../router');

/**
 * What a customer's photo shows - one AI call with the image.
 *
 * Returns {
 *   kind: 'product' | 'payment' | 'screenshot' | 'document' | 'other',
 *   description: one or two plain sentences,
 *   text: any readable text in the image (short),
 *   searchTerms: words to look the item up in the catalogue,
 *   payment: true when it looks like a receipt / payment confirmation / MoMo or bank transfer screen
 * }
 * A payment screenshot is never treated as proof - the agent only says a team
 * member will confirm (core/whatsapp/replyPolicy.js).
 */

const KINDS = ['product', 'payment', 'screenshot', 'document', 'other'];

const PROMPT = 'A customer sent this photo to a business on WhatsApp. Describe it so a shop assistant can help them.\n'
  + 'Answer with ONLY JSON:\n'
  + '{"kind": "product" | "payment" | "screenshot" | "document" | "other",\n'
  + ' "description": "one or two plain sentences: what it shows (item type, colour, style, brand if visible)",\n'
  + ' "text": "readable text in the image, if any (max 300 characters)",\n'
  + ' "search_terms": ["3-8 short words to find this item in a product list, e.g. trouser, black, slim"]}\n'
  + 'Use "payment" for receipts, mobile money (MoMo) or bank transfer confirmations and payment screenshots.';

function parse(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  let j = {};
  try { j = JSON.parse(m ? m[0] : '{}'); } catch { j = {}; }
  const kind = KINDS.includes(j.kind) ? j.kind : 'other';
  const terms = Array.isArray(j.search_terms) ? j.search_terms.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 8) : [];
  const said = `${j.description || ''} ${j.text || ''}`.toLowerCase();
  const payment = kind === 'payment' || /\b(momo|mobile money|transaction id|transfer successful|payment successful|you have (sent|paid)|receipt)\b/.test(said);
  return {
    kind: payment ? 'payment' : kind,
    description: String(j.description || 'a photo').slice(0, 400),
    text: String(j.text || '').slice(0, 300),
    searchTerms: terms,
    payment,
  };
}

/** @param {{data: string, mimetype: string}} image - base64 */
async function describe(image) {
  const result = await selectProvider({}).complete({
    maxTokens: 600,
    system: 'You describe customer photos accurately and briefly. Never guess prices or brands you cannot see.',
    content: [{ inlineData: { mimeType: image.mimetype || 'image/jpeg', data: image.data } }, { text: PROMPT }],
    prompt: PROMPT,
  });
  return parse(result.text);
}

/** Line added to the conversation so the reply knows what the photo showed. */
function asMessageText(seen, caption = '') {
  const text = seen.text ? ` Text in it: "${seen.text}".` : '';
  return `${caption ? `${caption}\n` : ''}[The customer sent a photo. It shows: ${seen.description}.${text}]`;
}

module.exports = { describe, parse, asMessageText, PROMPT };
