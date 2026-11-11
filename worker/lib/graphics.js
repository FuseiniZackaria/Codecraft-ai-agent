const fs = require('fs');
const path = require('path');
const { config, childEnv } = require('./config');
const { run } = require('./run');
const api = require('./api');

/**
 * Branded captions and graphics with HyperFrames (HTML rendered to video),
 * rendered FREE on this machine (`hyperframes render`, never the cloud) as a
 * transparent WebM overlay the export lays over the edited video.
 *
 * What's on it, in the brand's colours and font:
 *   - word-by-word captions (the word being said lights up in the brand colour);
 *   - a short intro with the business name (and logo when there is one);
 *   - B-roll photos whose file name matches what's being said, as a card;
 *   - the call to action as an end card.
 * Follows the HyperFrames SKILL.md contract: every timed element is a .clip
 * with data-start/data-duration; one paused timeline registered on
 * window.__timelines; only children of clips are animated; no timers,
 * randomness or network during the render (images are downloaded first).
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function luminance(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const textOn = (hex) => (luminance(hex) > 0.45 ? '#111111' : '#FFFFFF');

/** Words -> caption groups: 3 words (vertical) / 5 (landscape), broken at sentence ends and pauses. */
function captionGroups(words, { vertical, duration }) {
  const max = vertical ? 3 : 5;
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || cur.length >= max || /[.!?,;:]$/.test(w.text) || next.start - w.end >= 0.15) flush();
  });
  return groups.map((g, i) => {
    const start = Math.max(0.1, g[0].start - 0.05);
    const nextStart = groups[i + 1] ? groups[i + 1][0].start - 0.05 : duration;
    const end = Math.min(nextStart, g[g.length - 1].end + 0.25, duration);
    return { words: g, start: +start.toFixed(3), duration: +Math.max(0.2, end - start).toFixed(3) };
  }).filter((g) => g.start < duration);
}

/** B-roll photos whose name matches what's said (e.g. "jollof-rice.jpg" when "jollof" is said). */
function brollMoments(groups, broll) {
  const images = (broll || []).filter((b) => b.kind === 'image' && b.file);
  const used = new Set();
  const moments = [];
  let lastEnd = -10;
  for (const g of groups) {
    if (g.start - lastEnd < 6) continue;
    const said = new Set(g.words.map((w) => w.text.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((w) => w.length >= 4));
    const hit = images.find((b) => !used.has(b.file) && b.name.toLowerCase().split(/[^a-z0-9]+/).some((k) => k.length >= 4 && said.has(k)));
    if (hit) {
      used.add(hit.file);
      moments.push({ file: hit.file, start: g.start, duration: 2.8 });
      lastEnd = g.start + 2.8;
    }
  }
  return moments;
}

function compositionHtml({ width, height, duration, words, brand, businessName, cta, captions, logoFile, broll }) {
  const vertical = height > width;
  const k = Math.min(width, height) / 1080; // sizes scale with the frame (4K = 2x)
  const [c1, c2] = brand.colors.length >= 2 ? brand.colors : ['#E4572E', '#1B1B1E'];
  const font = brand.font || 'Montserrat';
  const groups = captions ? captionGroups(words, { vertical, duration }) : [];
  const moments = captions ? brollMoments(groups, broll) : [];
  const capBottom = Math.round((vertical ? 640 : 110) * k);
  const capSize = Math.round((vertical ? 78 : 64) * k);
  const introEnd = Math.min(3.6, duration * 0.4);
  const ctaLen = Math.min(3.2, Math.max(1.5, duration * 0.3));
  const ctaStart = Math.max(introEnd, duration - ctaLen);

  const css = `
html, body { margin: 0; background: transparent; }
#root { position: relative; overflow: hidden; font-family: '${font}', sans-serif; }
.cap { position: absolute; left: 0; right: 0; bottom: ${capBottom}px; text-align: center; padding: 0 ${Math.round(60 * k)}px; overflow: visible; }
.cap span { display: inline-block; margin: 0 ${Math.round(8 * k)}px; font-size: ${capSize}px; font-weight: 800; color: #FFFFFF; text-transform: ${vertical ? 'uppercase' : 'none'};
  -webkit-text-stroke: ${Math.max(2, Math.round(5 * k))}px rgba(0,0,0,0.85); paint-order: stroke fill; text-shadow: 0 ${Math.round(4 * k)}px ${Math.round(14 * k)}px rgba(0,0,0,0.55); }
.intro-bar { position: absolute; left: ${Math.round(60 * k)}px; top: ${Math.round((vertical ? 220 : 70) * k)}px; display: flex; align-items: center; gap: ${Math.round(20 * k)}px;
  background: ${c1}; color: ${textOn(c1)}; padding: ${Math.round(18 * k)}px ${Math.round(34 * k)}px; border-radius: ${Math.round(18 * k)}px; font-size: ${Math.round(46 * k)}px; font-weight: 800;
  box-shadow: 0 ${Math.round(10 * k)}px ${Math.round(30 * k)}px rgba(0,0,0,0.35); }
.intro-bar img { height: ${Math.round(72 * k)}px; width: auto; border-radius: ${Math.round(10 * k)}px; }
.cta-card { position: absolute; left: ${Math.round(60 * k)}px; right: ${Math.round(60 * k)}px; bottom: ${Math.round((vertical ? 300 : 180) * k)}px; text-align: center;
  background: ${c2}; color: ${textOn(c2)}; border: ${Math.round(6 * k)}px solid ${c1}; padding: ${Math.round(30 * k)}px; border-radius: ${Math.round(26 * k)}px; font-size: ${Math.round(58 * k)}px; font-weight: 800;
  box-shadow: 0 ${Math.round(12 * k)}px ${Math.round(40 * k)}px rgba(0,0,0,0.4); }
.cta-card img { display: block; height: ${Math.round(90 * k)}px; width: auto; margin: 0 auto ${Math.round(16 * k)}px; }
.broll { position: absolute; left: 50%; top: ${Math.round((vertical ? 300 : 90) * k)}px; width: ${Math.round((vertical ? 640 : 520) * k)}px; margin-left: -${Math.round((vertical ? 320 : 260) * k)}px;
  border: ${Math.round(8 * k)}px solid ${c1}; border-radius: ${Math.round(24 * k)}px; overflow: hidden; box-shadow: 0 ${Math.round(14 * k)}px ${Math.round(40 * k)}px rgba(0,0,0,0.45); }
.broll img { display: block; width: 100%; height: auto; }`;

  const parts = [];
  const tl = [];
  if (businessName || logoFile) {
    parts.push(`<div id="intro" class="clip" data-start="0.3" data-duration="${(introEnd - 0.3).toFixed(3)}" data-track-index="2"><div id="intro-bar" class="intro-bar">${logoFile ? `<img src="assets/${esc(logoFile)}" alt="">` : ''}${esc(businessName || '')}</div></div>`);
    tl.push(`tl.fromTo("#intro-bar", { x: ${-Math.round(80 * k)}, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, 0.3);`);
    tl.push(`tl.to("#intro-bar", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${(introEnd - 0.32).toFixed(3)});`);
  }
  groups.forEach((g, i) => {
    const id = `cap${i}`;
    parts.push(`<div id="${id}" class="clip" data-start="${g.start}" data-duration="${g.duration}" data-track-index="1"><div id="${id}-in" class="cap">${g.words.map((w, j) => `<span id="${id}w${j}">${esc(w.text)}</span>`).join('')}</div></div>`);
    tl.push(`tl.fromTo("#${id}-in", { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.12, ease: "power2.out" }, ${g.start});`);
    g.words.forEach((w, j) => {
      tl.push(`tl.set("#${id}w${j}", { color: "${c1}" }, ${Math.max(g.start, w.start).toFixed(3)});`);
      if (j < g.words.length - 1) tl.push(`tl.set("#${id}w${j}", { color: "#FFFFFF" }, ${Math.max(g.start, g.words[j + 1].start).toFixed(3)});`);
    });
  });
  moments.forEach((m, i) => {
    const id = `broll${i}`;
    parts.push(`<div id="${id}" class="clip" data-start="${m.start}" data-duration="${m.duration}" data-track-index="3"><div id="${id}-in" class="broll"><img src="assets/${esc(m.file)}" alt=""></div></div>`);
    tl.push(`tl.fromTo("#${id}-in", { y: ${Math.round(40 * k)}, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, ${m.start});`);
    tl.push(`tl.to("#${id}-in", { opacity: 0, duration: 0.25 }, ${(m.start + m.duration - 0.27).toFixed(3)});`);
  });
  if (cta) {
    parts.push(`<div id="cta" class="clip" data-start="${ctaStart.toFixed(3)}" data-duration="${(duration - ctaStart).toFixed(3)}" data-track-index="4"><div id="cta-in" class="cta-card">${logoFile ? `<img src="assets/${esc(logoFile)}" alt="">` : ''}${esc(cta)}</div></div>`);
    tl.push(`tl.fromTo("#cta-in", { y: ${Math.round(120 * k)}, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "back.out(1.6)" }, ${ctaStart.toFixed(3)});`);
  }

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=${width}, height=${height}">
<script src="assets/gsap.min.js"></script>
<style>${css}
html, body { width: ${width}px; height: ${height}px; overflow: hidden; }</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration.toFixed(3)}" data-width="${width}" data-height="${height}" style="width:${width}px;height:${height}px">
${parts.join('\n')}
</div>
<script>
const tl = gsap.timeline({ paused: true });
${tl.join('\n')}
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
}

/** Download the logo and B-roll photos into the project (renders never fetch from the network). */
async function fetchAssets(projectDir, brand) {
  const assets = path.join(projectDir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  let logoFile = null;
  if (brand?.logoUrl) {
    const ext = (/\.(png|jpe?g|webp|svg)(\?|$)/i.exec(brand.logoUrl)?.[1] || 'png').toLowerCase();
    logoFile = `logo.${ext}`;
    await api.download(brand.logoUrl, path.join(assets, logoFile)).catch(() => { logoFile = null; });
  }
  const broll = [];
  for (const [i, b] of (brand?.broll || []).entries()) {
    if (b.kind !== 'image' || !b.url || i >= 30) continue;
    const ext = (/\.(png|jpe?g|webp)$/i.exec(b.name || '')?.[1] || 'jpg').toLowerCase();
    const file = `broll${i}.${ext}`;
    try { await api.download(b.url, path.join(assets, file)); broll.push({ ...b, file }); } catch { /* skip a missing photo */ }
  }
  return { logoFile, broll };
}

/**
 * Render the overlay (transparent WebM) for one part.
 * @returns {string} path to overlay.webm
 */
async function renderOverlay({ workDir, name, width, height, fps, duration, words, brand, businessName, cta, captions, assets }) {
  const projectDir = path.join(workDir, `${name}-graphics`);
  fs.mkdirSync(projectDir, { recursive: true });
  const { logoFile, broll } = assets || await fetchAssets(projectDir, brand);
  if (assets) {
    // Reuse downloaded assets from the first part.
    fs.cpSync(path.join(assets.dir, 'assets'), path.join(projectDir, 'assets'), { recursive: true });
  }
  // GSAP from the worker's own install (no CDN fetch during the render).
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'), path.join(projectDir, 'assets', 'gsap.min.js'));
  fs.writeFileSync(path.join(projectDir, 'index.html'), compositionHtml({ width, height, duration, words, brand, businessName, cta, captions, logoFile, broll }));
  const out = path.join(workDir, `${name}.overlay.webm`);
  // Local render only (never `cloud render`): headless Chrome + FFmpeg on this machine.
  await run(process.execPath, [config.hyperframesBin, 'render', '--format', 'webm', '--fps', String(fps), '--quality', 'high', '-o', out], {
    cwd: projectDir,
    env: childEnv(),
    timeoutMs: Math.max(30 * 60000, Math.round(duration * 60000)), // up to a minute per second of video on a slow laptop
  });
  if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error('The captions/graphics render produced no video.');
  return { file: out, assets: { logoFile, broll, dir: projectDir } };
}

module.exports = { renderOverlay, compositionHtml, captionGroups, brollMoments, fetchAssets, textOn };
