/**
 * "Open Perry's WhatsApp" / "show me Ama's DM" - find that person's WhatsApp
 * conversation and pop it open on the user's screen.
 *
 * Matching is forgiving, because requests are often typed by voice
 * ("Paris" for "Perry", "Essando" for "Essandoh"): it compares each word of
 * the request with the WhatsApp name of every conversation, and with the name
 * Ian learned on the Leads page, by spelling closeness. A number works too.
 *
 * The result carries `ui` = { action: 'open_whatsapp_chat', number, name }.
 * That part goes to the user's browser only (core/assistant/index.js strips
 * it before the AI sees the result), so the AI never sees full phone numbers.
 */

const STOP = new Set(['open', 'show', 'the', 'my', 'his', 'her', 'their', 'chat', 'chats', 'dm', 'dms', 'inbox', 'whatsapp',
  'message', 'messages', 'conversation', 'with', 'for', 'from', 'me', 'please', 'up', 'of', 'to', 'and', 'mr', 'mrs', 'ms', 'miss', 'dr']);

const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w));

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** The consonant "shape" of a word, for sound-alike matching: "perry" -> "pr", "paris" -> "prs", "essandoh" -> "snd". */
const skeleton = (w) => w.replace(/[aeiouyhw]/g, '').replace(/(.)\1+/g, '$1');

/** 0..1 - how alike two words are (1 = same; a prefix counts strongly: "ess" ~ "essandoh"). */
function wordScore(q, w) {
  if (q === w) return 1;
  if (w.startsWith(q) && q.length >= 3) return 0.9;
  if (q.startsWith(w) && w.length >= 3) return 0.85;
  const spelled = 1 - editDistance(q, w) / Math.max(q.length, w.length);
  // Voice typing: words that sound alike share their consonants ("paris" ~ "perry", "stand" ~ "essandoh").
  const [sq, sw] = [skeleton(q), skeleton(w)];
  const sounded = sq.length >= 2 && sw.length >= 2 ? (1 - editDistance(sq, sw) / Math.max(sq.length, sw.length)) * 0.9 : 0;
  const sim = Math.max(spelled, sounded);
  return sim >= 0.6 ? sim : 0;
}

/** How well the request matches one set of names (0..1). */
function nameScore(queryWords, names) {
  const nameWords = names.flatMap(words);
  if (!queryWords.length || !nameWords.length) return 0;
  const per = queryWords.map((q) => Math.max(0, ...nameWords.map((w) => wordScore(q, w))));
  const matched = per.filter((s) => s > 0);
  if (!matched.length) return 0;
  // Average over the words that matched, a little credit for matching more of them.
  return (matched.reduce((a, b) => a + b, 0) / matched.length) * (0.85 + 0.15 * (matched.length / queryWords.length));
}

const last4 = (n) => String(n || '').slice(-4);

/**
 * @param {{ who: string }} input
 * @param {{ userId, workspaceId }} context
 */
async function openWhatsappChat(input = {}, context = {}) {
  const who = String(input.who || '').trim();
  if (!who) return { ok: false, error: 'Say whose WhatsApp chat to open (a name or number).' };
  if (!context.userId) return { ok: false, error: "I can't see your WhatsApp chats from here - open Work -> Inbox." };

  const wa = require('../whatsapp/store');
  const conversations = await wa.listConversations({ userId: context.userId, workspaceId: context.workspaceId || null });
  if (!conversations.length) return { ok: false, error: 'There are no WhatsApp conversations yet.' };

  // Names Ian learned for these numbers (Leads page), to match "Essandoh Perry" when WhatsApp only says "Perry".
  let leadNames = new Map();
  if (context.workspaceId) {
    try {
      const leads = await require('../leads/store').listLeads(context.workspaceId);
      leadNames = new Map(leads.filter((l) => l.source === 'whatsapp').map((l) => [l.contact_number, l.name]));
    } catch { /* leads not set up - WhatsApp names only */ }
  }

  const digits = who.replace(/\D/g, '');
  let scored;
  if (digits.length >= 4) {
    scored = conversations.map((c) => ({ c, score: c.contactNumber.endsWith(digits) || c.contactNumber.includes(digits) ? 1 : 0 }));
  } else {
    const q = words(who);
    scored = conversations.map((c) => ({ c, score: nameScore(q, [c.contactName, leadNames.get(c.contactNumber)]) }));
  }
  scored = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || String(b.c.lastAt).localeCompare(String(a.c.lastAt)));
  const label = (c) => leadNames.get(c.contactNumber) || c.contactName || `the number ending ${last4(c.contactNumber)}`;

  if (!scored.length) {
    const recent = conversations.slice(0, 6).map((c) => label(c));
    return { ok: false, error: `No WhatsApp chat matches "${who}".`, recent_chats: recent };
  }

  const [best, second] = scored;
  // Clearly the one: a strong match, well ahead of the next.
  if (best.score >= 0.6 && (!second || best.score - second.score >= 0.12)) {
    const name = label(best.c);
    return {
      ok: true,
      opened: true,
      name,
      last_message: String(best.c.lastMessage || '').slice(0, 200),
      last_message_from: best.c.lastDirection === 'in' ? name : 'you',
      last_at: best.c.lastAt,
      note: "The chat is now open on the user's screen.",
      ui: { action: 'open_whatsapp_chat', number: best.c.contactNumber, name },
    };
  }

  // Several close matches: ask which one.
  return {
    ok: true,
    opened: false,
    question: `Several chats could be "${who}" - ask which one.`,
    candidates: scored.slice(0, 5).map((x) => ({ name: label(x.c), number_ends: last4(x.c.contactNumber), last_at: x.c.lastAt })),
  };
}

const DEFINITION = {
  name: 'open_whatsapp_chat',
  description:
    "Open a person's WhatsApp conversation on the user's screen (a pop-up chat window with the messages and a reply box). " +
    'Use it whenever the user asks to open / show / see / pull up someone\'s WhatsApp, chat, DM, inbox or conversation by name or number - ' +
    'unless they clearly mean Gmail/email or another app. Names may be misheard by voice typing: pass what they said. ' +
    'If it returns candidates, ask which person. Never search Gmail for this.',
  input_schema: {
    type: 'object',
    properties: { who: { type: 'string', description: 'The person\'s name (as said) or phone number, e.g. "Essandoh Perry".' } },
    required: ['who'],
  },
};

module.exports = { openWhatsappChat, DEFINITION, nameScore, words };
