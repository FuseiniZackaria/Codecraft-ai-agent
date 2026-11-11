/**
 * The plans you approve before anything is rendered, written by Claude
 * (Sonnet, VIDEO_PLAN_MODEL) and then checked strictly - the worker only ever
 * gets steps it can really do. Anything asked that it can't do is listed in
 * plain words ("Can't do: ...") before you approve, never silently dropped.
 *
 *   customPlan()  "Edit my video my way": your description + the word-level transcript
 *   websitePlan() "Make a video of my website": the explored pages -> scenes + voiceover
 */

const cutPlanner = require('./cutPlanner');

const PLAN_MODEL = process.env.VIDEO_PLAN_MODEL || 'claude-sonnet-5-5';
const WORDS_PER_SECOND = 2.4; // natural voiceover pace

async function askClaude({ system, prompt, content = null, maxTokens = 3000 }) {
  const { selectProvider } = require('../router');
  const r = await selectProvider({}).complete({ system, prompt, content, maxTokens, claudeModel: PLAN_MODEL });
  const m = String(r.text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('the AI answered without a plan');
  return JSON.parse(m[0]);
}

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, max, n) => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);

// ---------------------------------------------------------------------------
// "Edit my video my way"
// ---------------------------------------------------------------------------

const CUSTOM_CAN = [
  'keep, cut or re-order any parts (by word number)',
  'remove retakes and pauses longer than half a second',
  'word-by-word captions in the brand colours, on or off',
  'smooth zoom-ins on a stretch of speech',
  'title cards (short text on screen)',
  'show photos: the business\'s B-roll kit or screenshots of the reference website',
  'a business-name intro and the call-to-action end card',
];
const CUSTOM_CANNOT = 'music, sound effects, new footage, AI-generated images or video, changing voices, speed changes, green-screen or background removal, colour "looks" (light and grain are fixed automatically)';

/**
 * @param {{ words, duration, description, answers, images: string[] }} input
 *   images: names of photos it may show (B-roll kit + reference-site screenshots)
 */
async function customPlan({ words, duration, description, answers = {}, images = [], reference = null }) {
  const tidy = cutPlanner.tidyWords(words, duration);
  if (!tidy.length) throw new Error('No speech was found in the video, so there is nothing to plan from. Try the automatic edit instead.');
  const sentences = cutPlanner.sentencesOf(tidy);
  let wi = 0;
  const lines = sentences.map((s) => {
    const from = wi;
    wi += s.words.length;
    return `w${from}-w${wi - 1} [${s.start.toFixed(1)}s]: ${s.text}`;
  });
  const system =
    'You are a video editor. Turn the person\'s description into an edit plan for their talking video, using ONLY these abilities: '
    + `${CUSTOM_CAN.join('; ')}. You CANNOT do: ${CUSTOM_CANNOT} - anything like that goes in "cant_do". `
    + 'Refer to the video by word numbers (w0, w1, ...). Answer with ONLY JSON:\n'
    + '{"summary":["plain-English bullet of what you will do", ...],"cant_do":["what was asked but can\'t be done", ...],'
    + '"segments":[{"from":0,"to":41}],"tidy":{"retakes":true,"pauses":true},"captions":true,'
    + '"zooms":[{"from":12,"to":20,"scale":1.2}],"titles":[{"at":0,"text":"3 tips","seconds":2.5}],"broll":[{"at":30,"image":"<exact name from the list>","seconds":3}]}\n'
    + '"segments" are the parts to keep IN THE ORDER they should play (re-order by listing them in a new order). Keep captions on unless asked for none. '
    + 'Summary bullets are short, friendly and specific (they are shown to the business owner for approval).';
  const prompt = [
    `What they want: "${str(description, 2000)}"`,
    `Where it goes: ${answers.platform || 'social media'}. End with: ${answers.cta || '(no call to action)'}.`,
    reference ? `Reference website (${reference.url}): ${str(reference.title, 120)} - ${str(reference.summary, 600)}` : '',
    images.length ? `Photos it may show (exact names): ${images.join(', ')}` : 'No photos are available.',
    `The video (${duration ? `${duration.toFixed(1)}s` : 'length unknown'}), sentence by sentence:\n${lines.join('\n').slice(0, 30000)}`,
  ].filter(Boolean).join('\n\n');

  const raw = await askClaude({ system, prompt });
  return validateCustom(raw, { words: tidy, images, duration });
}

function validateCustom(raw, { words, images, duration }) {
  const n = words.length;
  const ok = (i) => Number.isInteger(i) && i >= 0 && i < n;
  const segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .map((s) => ({ from: int(s.from), to: int(s.to) }))
    .filter((s) => ok(s.from) && ok(s.to) && s.from <= s.to)
    .slice(0, 60);
  if (!segments.length) segments.push({ from: 0, to: n - 1 });
  const inKept = (i) => segments.some((s) => i >= s.from && i <= s.to);
  const plan = {
    kind: 'custom',
    summary: list(raw.summary, 240, 12),
    cant_do: list(raw.cant_do, 240, 8),
    segments,
    tidy: { retakes: raw.tidy?.retakes !== false, pauses: raw.tidy?.pauses !== false },
    captions: raw.captions !== false,
    zooms: (Array.isArray(raw.zooms) ? raw.zooms : []).map((z) => ({ from: int(z.from), to: int(z.to), scale: Math.min(1.6, Math.max(1.05, Number(z.scale) || 1.2)) }))
      .filter((z) => ok(z.from) && ok(z.to) && z.from <= z.to && inKept(z.from)).slice(0, 20),
    titles: (Array.isArray(raw.titles) ? raw.titles : []).map((t) => ({ at: int(t.at), text: str(t.text, 60), seconds: Math.min(6, Math.max(1.2, Number(t.seconds) || 2.5)) }))
      .filter((t) => ok(t.at) && t.text && inKept(t.at)).slice(0, 12),
    broll: (Array.isArray(raw.broll) ? raw.broll : []).map((b) => ({ at: int(b.at), image: str(b.image, 200), seconds: Math.min(6, Math.max(1.5, Number(b.seconds) || 3)) }))
      .filter((b) => ok(b.at) && images.includes(b.image) && inKept(b.at)).slice(0, 15),
  };
  if (!plan.summary.length) plan.summary = ['Keep the parts listed below, in that order, with your brand captions.'];
  plan.render = customRanges(words, plan, duration);
  plan.estimatedSeconds = +plan.render.ranges.reduce((s, r) => s + (r.end - r.start), 0).toFixed(1);
  return plan;
}

/** Plan -> ordered time ranges (retakes and long pauses removed inside each kept part if asked). */
function customRanges(words, plan, duration) {
  const ranges = [];
  for (const seg of plan.segments) {
    const segWords = words.slice(seg.from, seg.to + 1);
    const sentences = cutPlanner.sentencesOf(segWords);
    const drop = plan.tidy.retakes ? cutPlanner.ruleDrops(sentences) : new Set();
    const kept = new Set(sentences.filter((s) => !drop.has(s.id)).map((s) => s.id));
    if (!kept.size) sentences.forEach((s) => kept.add(s.id));
    if (plan.tidy.pauses) {
      ranges.push(...cutPlanner.rangesFor(sentences, kept, 0, sentences.length - 1, duration).ranges);
    } else {
      const ks = sentences.filter((s) => kept.has(s.id));
      ranges.push({ start: Math.max(0, ks[0].start - 0.08), end: duration ? Math.min(duration, ks[ks.length - 1].end + 0.14) : ks[ks.length - 1].end + 0.14 });
    }
  }
  // Word times for titles/zooms/B-roll, so the worker can place them on the new timeline.
  const at = (i) => words[i].start;
  return {
    ranges: ranges.map((r) => ({ start: +r.start.toFixed(3), end: +r.end.toFixed(3) })),
    zooms: plan.zooms.map((z) => ({ start: at(z.from), end: words[z.to].end, scale: z.scale })),
    titles: plan.titles.map((t) => ({ start: at(t.at), text: t.text, seconds: t.seconds })),
    broll: plan.broll.map((b) => ({ start: at(b.at), image: b.image, seconds: b.seconds })),
  };
}

/** No AI: the automatic edit, offered as a plan (with an honest note). */
async function fallbackCustom({ words, duration }) {
  const auto = await cutPlanner.plan({ words, duration });
  return {
    kind: 'custom',
    summary: ['The AI planner did not answer, so this is the automatic edit: retakes and long pauses removed, brand captions added.'],
    cant_do: ['Your own instructions could not be read this time - choose "Change it" to try again.'],
    segments: [], tidy: { retakes: true, pauses: true }, captions: true, zooms: [], titles: [], broll: [],
    render: { ranges: (auto.parts[0]?.ranges || [{ start: 0, end: duration }]), zooms: [], titles: [], broll: [] },
    estimatedSeconds: auto.parts[0]?.duration || duration,
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// "Make a video of my website"
// ---------------------------------------------------------------------------

/**
 * @param {{ pages: [{ p, url, title, headings, text, clicks: [{ c, label }] }], thumbs: [{ p, base64 }], description, answers, businessName, brandVoice }} input
 */
async function websitePlan({ pages, thumbs = [], description, answers = {}, businessName = null, brandVoice = null, notes = [] }) {
  if (!pages.length) throw new Error('No pages of the website could be opened, so there is nothing to plan.');
  const target = targetSeconds(description, answers.platform);
  const system =
    'You make short website walkthrough videos. From the explored pages (with screenshots), choose which pages to show, in what order, '
    + 'whether to scroll down a page, show its top, or show the result of clicking one of its listed clickable items, and write the voiceover for each scene. '
    + `Voiceover: natural, specific to THIS site, about ${WORDS_PER_SECOND} words per second, total about ${Math.round(target * WORDS_PER_SECOND)} words for a ${target}-second video. `
    + 'Start with a hook, end with the call to action. Never invent features that are not on the pages. '
    + 'Only use page numbers (p) and click numbers (c) from the list. Things you cannot do (filling forms, buying, logging in to other sites, showing pages that were not explored, music) go in "cant_do". '
    + 'Answer with ONLY JSON: {"title":"short video title","summary":["plain bullet for the owner",...],"cant_do":[...],'
    + '"scenes":[{"page":0,"show":"top"|"scroll"|"click","click":2,"narration":"..."}]}. 3 to 12 scenes.';
  const pageText = pages.map((pg) => [
    `p${pg.p}: ${str(pg.title, 120)} (${pg.url})`,
    pg.headings?.length ? `  headings: ${pg.headings.slice(0, 12).map((h) => str(h, 80)).join(' | ')}` : '',
    pg.text ? `  text: ${str(pg.text, 700)}` : '',
    pg.clicks?.length ? `  clickable (after-click screenshot exists): ${pg.clicks.map((c) => `c${c.c} "${str(c.label, 50)}"`).join(', ')}` : '',
  ].filter(Boolean).join('\n')).join('\n');
  const prompt = [
    `What they want: "${str(description, 2000)}"`,
    `Business: ${businessName || 'unknown'}${brandVoice ? `. Brand voice: ${brandVoice}` : ''}`,
    `Platform: ${answers.platform || 'tiktok'} (${answers.platform === 'youtube' ? '16:9' : '9:16 phone'}). Call to action at the end: ${answers.cta || 'visit the website'}`,
    notes.length ? `While exploring: ${notes.join(' ')}` : '',
    `Explored pages:\n${pageText}`.slice(0, 40000),
  ].filter(Boolean).join('\n\n');
  const content = [
    ...thumbs.slice(0, 10).flatMap((t) => [{ text: `Screenshot of p${t.p}:` }, { inlineData: { mimeType: 'image/jpeg', data: t.base64 } }]),
    { text: prompt },
  ];
  const raw = await askClaude({ system, prompt, content, maxTokens: 4000 });
  return validateWebsite(raw, { pages, target });
}

function targetSeconds(description, platform) {
  const m = /(\d{1,3})\s*(?:-|\s)?\s*(seconds?|secs?|s\b|minutes?|mins?)/i.exec(String(description || ''));
  if (m) {
    const n = Number(m[1]) * (/^m/i.test(m[2]) ? 60 : 1);
    if (n >= 10 && n <= 180) return n;
  }
  return platform === 'youtube' ? 75 : 45;
}

function validateWebsite(raw, { pages, target }) {
  const byP = new Map(pages.map((pg) => [pg.p, pg]));
  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s) => {
    const page = int(s.page);
    const pg = byP.get(page);
    if (!pg) return null;
    let show = ['top', 'scroll', 'click'].includes(s.show) ? s.show : 'top';
    let click = null;
    if (show === 'click') {
      click = int(s.click);
      if (!(pg.clicks || []).some((c) => c.c === click)) { show = 'top'; click = null; }
    }
    const narration = str(s.narration, 500);
    return narration ? { page, show, click, narration } : null;
  }).filter(Boolean).slice(0, 12);
  if (scenes.length < 1) throw new Error('The plan had no usable scenes.');
  const words = scenes.reduce((s, x) => s + x.narration.split(' ').length, 0);
  return {
    kind: 'website',
    title: str(raw.title, 80) || 'Website walkthrough',
    summary: list(raw.summary, 240, 10),
    cant_do: list(raw.cant_do, 240, 8),
    scenes,
    targetSeconds: target,
    estimatedSeconds: Math.round(words / WORDS_PER_SECOND + scenes.length * 0.4 + 3),
  };
}

module.exports = { customPlan, fallbackCustom, websitePlan, validateCustom, validateWebsite, customRanges, targetSeconds, PLAN_MODEL };
