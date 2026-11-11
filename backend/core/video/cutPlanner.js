/**
 * Decide what to keep from a recording, from its word-level transcript:
 *   - retakes: "let's redo that" (and the failed take before it), and
 *     sentences restarted from the same words - the LAST (best) take is kept;
 *   - pauses longer than 0.5 s are cut down to a natural breath;
 *   - one recording with several videos in it is split into parts.
 *
 * Rules always run (free, instant). When an AI is available, it reads the
 * numbered sentences and decides retakes and parts more cleverly; anything
 * it says that doesn't check out is ignored and the rules' answer is used.
 *
 * Times are seconds in the ORIGINAL recording.
 */

const PAUSE_LIMIT = 0.5; // Jam: cut pauses longer than this
const KEEP_BEFORE = 0.08; // a little air before a word...
const KEEP_AFTER = 0.14; // ...and after it, so cuts don't clip syllables
const SENTENCE_GAP = 0.7;

const CUE = /\b(let'?s|let me|i'?ll|i will|i'?m going to|gonna)\s+(re-?do|re-?start|re-?try|try|do|start|say|take)\s+(that|this|it|again|over)( again| over)?\b|\b(take (two|2|three|3)|one more time|start (that |it )?(again|over)|cut (that|this)|scratch that|from the top|sorry,? (let me|i'?ll) (start|try|redo|do it)|redo that|do that again|again from the top)\b/i;

const clean = (w) => String(w || '').toLowerCase().replace(/[^a-z0-9'À-ɏ]+/g, '');

/** Usable words only: real text, sane times, no Whisper "thank you" over a silent tail. */
function tidyWords(words, duration = null) {
  const out = [];
  for (const w of Array.isArray(words) ? words : []) {
    const text = String(w.text ?? w.word ?? '').trim();
    const start = Number(w.start);
    const end = Number(w.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    if (/^\[.*\]$|^\(.*\)$|^[♪�]+$/.test(text)) continue; // [BLANK_AUDIO], (music), ♪
    out.push({ text, start, end: Math.max(end, start + 0.04) });
  }
  out.sort((a, b) => a.start - b.start);
  // Whisper invents "Thank you." / repeats over a silent ending: drop trailing words after a long gap.
  while (out.length > 2) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    if (last.start - prev.end > 2.5 && /^(thank you|thanks|you|bye)[.!]?$/i.test(last.text)) out.pop();
    else break;
  }
  if (duration) for (const w of out) w.end = Math.min(w.end, duration);
  return out;
}

/** Group words into sentences (end punctuation or a clear gap). */
function sentencesOf(words) {
  const sentences = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || /[.!?]["')\]]?$/.test(w.text) || next.start - w.end >= SENTENCE_GAP) {
      sentences.push({ id: sentences.length, words: cur, start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((x) => x.text).join(' ') });
      cur = [];
    }
  });
  return sentences;
}

const firstWords = (s, n) => s.words.slice(0, n).map((w) => clean(w.text)).filter(Boolean).join(' ');

/** Rules: which sentence ids are retakes to drop. */
function ruleDrops(sentences) {
  const drop = new Set();
  sentences.forEach((s, i) => {
    if (CUE.test(s.text)) {
      drop.add(s.id); // the "let's redo that" itself
      if (i > 0) drop.add(sentences[i - 1].id); // the take it refers to
    }
  });
  // A sentence restarted with the same opening words within 30 s: keep the later take.
  for (let i = 0; i < sentences.length; i++) {
    const a = sentences[i];
    const n = Math.min(4, a.words.length);
    if (n < 2) continue;
    const key = firstWords(a, n);
    for (let j = i + 1; j < sentences.length && sentences[j].start - a.end <= 30; j++) {
      if (firstWords(sentences[j], n) === key) { drop.add(a.id); break; }
    }
  }
  return drop;
}

/** Rules: split into separate videos at long silences followed by a fresh greeting. */
function ruleParts(sentences, kept) {
  const parts = [];
  let startId = null;
  let prev = null;
  for (const s of sentences) {
    if (!kept.has(s.id)) continue;
    if (startId === null) startId = s.id;
    else if (prev && s.start - prev.end >= 4 && /^(hi|hey|hello|welcome|what'?s up|good (morning|afternoon|evening)|today|in this video)\b/i.test(s.text.trim())) {
      parts.push({ from: startId, to: prev.id });
      startId = s.id;
    }
    prev = s;
  }
  if (startId !== null && prev) parts.push({ from: startId, to: prev.id });
  return parts.map((p, i) => ({ ...p, title: parts.length > 1 ? `Part ${i + 1}` : null }));
}

/** Keep ranges for one part: kept sentences' words, pauses over 0.5 s cut to a breath. */
function rangesFor(sentences, kept, fromId, toId, duration) {
  const words = sentences.filter((s) => kept.has(s.id) && s.id >= fromId && s.id <= toId).flatMap((s) => s.words);
  const ranges = [];
  let pausesCut = 0;
  for (const w of words) {
    const start = Math.max(0, w.start - KEEP_BEFORE);
    const end = duration ? Math.min(duration, w.end + KEEP_AFTER) : w.end + KEEP_AFTER;
    const last = ranges[ranges.length - 1];
    if (last && w.start - last.wordEnd <= PAUSE_LIMIT) {
      last.end = Math.max(last.end, end);
      last.wordEnd = w.end;
    } else {
      if (last) pausesCut += 1;
      ranges.push({ start, end, wordEnd: w.end });
    }
  }
  // Overlapping padding after cuts: merge.
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 0.02) last.end = Math.max(last.end, r.end);
    else merged.push({ start: +r.start.toFixed(3), end: +r.end.toFixed(3) });
  }
  return { ranges: merged.map((r) => ({ start: +r.start.toFixed(3), end: +r.end.toFixed(3) })), pausesCut };
}

/**
 * Ask the AI (if any) which sentences are failed takes and where separate
 * videos start. `ask(system, prompt)` returns the model's text.
 */
async function aiDecision(sentences, ask, script = null) {
  if (!ask || sentences.length < 2) return null;
  const numbered = sentences.map((s) => `${s.id}. [${s.start.toFixed(1)}s] ${s.text}`).join('\n');
  const system =
    'You edit talking-head videos. From a recording\'s numbered sentences, find failed takes: a sentence the speaker abandoned or said again later, '
    + 'and any "let\'s redo that"-type remarks. Keep only the best (usually the last, complete) take of each line. Never drop a sentence that is said only once and is fine. '
    + 'Also decide if the recording holds SEVERAL separate videos (a new intro/topic after a clear break): give each its first and last kept sentence number and a 2-5 word title. '
    + 'Answer with ONLY JSON: {"drop":[ids],"parts":[{"from":id,"to":id,"title":"..."}]}. One video: parts has one entry.';
  const prompt = `${script ? `The script they meant to say:\n${String(script).slice(0, 4000)}\n\n` : ''}Sentences:\n${numbered.slice(0, 24000)}`;
  const text = await ask(system, prompt);
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  const json = JSON.parse(m[0]);
  const ids = new Set(sentences.map((s) => s.id));
  const drop = new Set((Array.isArray(json.drop) ? json.drop : []).map(Number).filter((id) => ids.has(id)));
  if (drop.size >= sentences.length) return null; // dropping everything isn't an edit
  const parts = (Array.isArray(json.parts) ? json.parts : [])
    .map((p) => ({ from: Number(p.from), to: Number(p.to), title: String(p.title || '').slice(0, 60) || null }))
    .filter((p) => ids.has(p.from) && ids.has(p.to) && p.from <= p.to)
    .sort((a, b) => a.from - b.from);
  // Parts must not overlap.
  for (let i = 1; i < parts.length; i++) if (parts[i].from <= parts[i - 1].to) return { drop, parts: [] };
  return { drop, parts };
}

/**
 * @param {{ words: Array, duration: number, script?: string }} input
 * @param {{ ask?: Function }} opts
 * @returns {{ parts: [{ title, ranges: [{start,end}], duration }], retakesRemoved, pausesCut, secondsSaved, decidedBy, transcriptText }}
 */
async function plan({ words, duration = null, script = null }, { ask = null } = {}) {
  const tidy = tidyWords(words, duration);
  const sentences = sentencesOf(tidy);
  if (!sentences.length) {
    return { parts: [], retakesRemoved: 0, pausesCut: 0, secondsSaved: 0, decidedBy: 'rules', transcriptText: '', noSpeech: true };
  }
  const rules = ruleDrops(sentences);
  let drop = rules;
  let partsSpec = null;
  let decidedBy = 'rules';
  try {
    const ai = await aiDecision(sentences, ask, script);
    if (ai) {
      // Explicit "let's redo that" cues are always removed, whatever the AI said.
      drop = new Set([...ai.drop, ...[...rules].filter((id) => CUE.test(sentences[id].text))]);
      if (ai.parts.length) partsSpec = ai.parts;
      decidedBy = 'ai';
    }
  } catch (err) {
    console.warn(`[video] AI retake check failed, using the rules: ${err.message}`);
  }
  const kept = new Set(sentences.filter((s) => !drop.has(s.id)).map((s) => s.id));
  if (!kept.size) sentences.forEach((s) => kept.add(s.id)); // never return an empty video
  const spec = partsSpec || ruleParts(sentences, kept);

  let pausesCut = 0;
  const parts = spec.map((p) => {
    const { ranges, pausesCut: n } = rangesFor(sentences, kept, p.from, p.to, duration);
    pausesCut += n;
    return { title: p.title || null, ranges, duration: +ranges.reduce((s, r) => s + (r.end - r.start), 0).toFixed(3) };
  }).filter((p) => p.ranges.length);

  const keptSeconds = parts.reduce((s, p) => s + p.duration, 0);
  const total = duration || (tidy.length ? tidy[tidy.length - 1].end : 0);
  // A failed take can span several sentences: dropped sentences next to each other count as one retake.
  let retakesRemoved = 0;
  sentences.forEach((s, i) => {
    if (drop.has(s.id) && !CUE.test(s.text) && !(i > 0 && drop.has(sentences[i - 1].id) && !CUE.test(sentences[i - 1].text))) retakesRemoved += 1;
  });
  return {
    parts,
    retakesRemoved,
    pausesCut,
    secondsSaved: Math.max(0, +(total - keptSeconds).toFixed(1)),
    decidedBy,
    transcriptText: sentences.filter((s) => kept.has(s.id)).map((s) => s.text).join(' '),
  };
}

module.exports = { plan, tidyWords, sentencesOf, ruleDrops, rangesFor, CUE, PAUSE_LIMIT };
