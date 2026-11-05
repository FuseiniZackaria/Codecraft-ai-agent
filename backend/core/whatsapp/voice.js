const fs = require('fs');
const path = require('path');

/**
 * Ian's WhatsApp voice, loaded from backend/config/whatsapp-voice.md (or the
 * file in WA_VOICE_FILE). The file is re-read whenever it changes, so tone
 * rules and fixed replies can be edited without touching code.
 *
 * Sections ("## Heading") become the AI's instructions, except the fixed texts
 * below, which are sent to customers as written.
 */

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'config', 'whatsapp-voice.md');

// heading (lower case) -> key
const FIXED_SECTIONS = {
  'hold reply': 'hold',
  'voice note reply': 'voice',
  'image reply': 'image',
  'sticker reply': 'sticker',
  'file reply': 'file',
  signature: 'signature',
};

const FALLBACK_TEXTS = {
  hold: 'Let me check with the team and get back to you shortly.',
  voice: "Sorry, I can't play voice notes here yet. Could you type it for me?",
  image: "Thanks for sending that! I can't open images here yet. Could you type what you need?",
  sticker: 'How can I help you today?',
  file: "Thanks! I can't open files here yet. Could you type a short message about what you need?",
  signature: '',
};

// Used only if the voice file is missing or empty.
const FALLBACK_INSTRUCTIONS =
  'Who you are:\n- You are Ian from CodeCraft, CodeCraft\'s assistant. You are not the founder or owner and never use another ' +
  'personal name. If asked whether you are a bot, say honestly that you are CodeCraft\'s AI assistant.\n\n' +
  'Tone:\n- Friendly, professional and short (1-3 sentences), at most one question, no sign-off or signature.';

let cache = { file: null, mtimeMs: null, voice: null };

function voiceFile() {
  return process.env.WA_VOICE_FILE || DEFAULT_FILE;
}

/** Markdown -> { instructions, hold, voice, image, sticker, file, signature }. */
function parseVoice(markdown) {
  const text = String(markdown || '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  const voice = { ...FALLBACK_TEXTS, instructions: '' };
  const instructions = [];
  for (const s of sections) {
    const body = s.lines.join('\n').trim();
    const key = FIXED_SECTIONS[s.title.toLowerCase()];
    if (key === 'signature') voice.signature = body; // empty = no signature
    else if (key) { if (body) voice[key] = body; }
    else if (body) instructions.push(`${s.title}:\n${body}`);
  }
  voice.instructions = instructions.join('\n\n') || FALLBACK_INSTRUCTIONS;
  return voice;
}

function loadVoice() {
  const file = voiceFile();
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cache.file !== file || cache.mtimeMs !== mtimeMs) {
      cache = { file, mtimeMs, voice: parseVoice(fs.readFileSync(file, 'utf8')) };
    }
  } catch (err) {
    if (cache.file !== file || cache.mtimeMs !== -1) {
      console.warn(`[whatsapp] voice file ${file} not readable (${err.message}) - using the built-in defaults`);
    }
    cache = { file, mtimeMs: -1, voice: parseVoice('') };
  }
  return cache.voice;
}

/** Time of day in Ghana (Africa/Accra) and the matching greeting. */
function ghanaTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  const hour = Number(get('hour'));
  const partOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return { hour, clock: `${get('hour')}:${get('minute')}`, partOfDay, greeting: `Good ${partOfDay}` };
}

module.exports = { loadVoice, parseVoice, ghanaTime, voiceFile, FALLBACK_TEXTS };
