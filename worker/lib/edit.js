const fs = require('fs');
const path = require('path');
const { ffmpeg } = require('./run');
const media = require('./media');

/**
 * The edit: cut the keep-ranges out of the ORIGINAL (which is only read,
 * never changed), level each stretch of voice on its own, fix the light,
 * and write a lossless master that the export then encodes once.
 *
 * Cutting uses one `select` over the source (not trim+concat), so memory
 * stays flat however many cuts there are. Cut points are snapped to whole
 * frames and the audio uses the same times, so sound never drifts from
 * the picture.
 */

const SPEECH_TARGET_DB = -20; // mean speech level each stretch is brought to
const MAX_BOOST_DB = 18;
const MAX_CUT_DB = 12;

/** Snap ranges to the frame grid: [start, end) with whole frames. */
function snapRanges(ranges, fps) {
  const out = [];
  for (const r of ranges) {
    const s = Math.ceil(r.start * fps - 1e-6) / fps;
    const e = Math.ceil(r.end * fps - 1e-6) / fps;
    if (e - s >= 1 / fps) out.push({ start: +s.toFixed(6), end: +e.toFixed(6) });
  }
  return out;
}

/** "between" sum: 1 inside any range, 0 outside (ranges never overlap). */
const insideExpr = (ranges) => ranges.map((r) => `gte(t,${r.start})*lt(t,${r.end})`).join('+');

/**
 * Light: brighten dark footage (and calm the grain that comes with it), tame
 * blown-out footage; say honestly when only a reshoot would really fix it.
 */
function lightPlan(light) {
  if (!light) return { filter: null, note: null, reshoot: false, fixed: false };
  const avg = light.average;
  if (avg < 95) {
    const gamma = Math.min(1.7, 1 + (95 - avg) / 90);
    const parts = [`eq=gamma=${gamma.toFixed(2)}:contrast=1.04:saturation=1.06`];
    if (avg < 80) parts.unshift('hqdn3d=1.5:1.5:6:6'); // dark footage is grainy: smooth it before brightening
    const reshoot = avg < 45 || light.darkest < 25;
    return {
      filter: parts.join(','),
      fixed: true,
      reshoot,
      note: reshoot
        ? 'The video was very dark. I brightened it and reduced the grain, but it will still look grainy - a reshoot with more light (face a window or a lamp) would look much better.'
        : 'The video was a bit dark: I brightened it and reduced the grain.',
    };
  }
  if (avg > 205) {
    return { filter: 'eq=gamma=0.88:contrast=1.02', fixed: true, reshoot: avg > 235, note: avg > 235 ? 'The video is very bright (overexposed). I toned it down, but detail lost in the bright parts cannot come back - a reshoot with less light behind you would look better.' : 'The video was a bit bright: I toned it down.' };
  }
  return { filter: null, fixed: false, reshoot: false, note: null };
}

/**
 * Each kept stretch's level (mean volume), so a quiet real voice and a loud
 * AI voice end up equally loud. Returns gains in dB, one per range.
 */
async function voiceGains(src, ranges, { onProgress } = {}) {
  const gains = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    let gain = 0;
    if (i < 300 && r.end - r.start >= 0.3) {
      const mean = await media.meanVolume(src, r.start, r.end).catch(() => null);
      if (mean !== null && mean > -55) gain = Math.max(-MAX_CUT_DB, Math.min(MAX_BOOST_DB, SPEECH_TARGET_DB - mean));
    }
    gains.push(+gain.toFixed(2));
    if (onProgress) onProgress((i + 1) / ranges.length);
  }
  // Very short bits take their neighbour's level (too short to measure well).
  for (let i = 0; i < ranges.length; i++) {
    if (ranges[i].end - ranges[i].start < 0.3) gains[i] = gains[i - 1] ?? gains[i + 1] ?? 0;
  }
  return gains;
}

/** Volume expression: each range's own gain (as a factor), 1 elsewhere. */
function gainExpr(ranges, gains) {
  const terms = ranges.map((r, i) => (gains[i] ? `gte(t,${r.start})*lt(t,${r.end})*${(10 ** (gains[i] / 20) - 1).toFixed(5)}` : null)).filter(Boolean);
  return terms.length ? `1+${terms.join('+')}` : '1';
}

/**
 * Write the lossless master for one part.
 * @returns {{ file, duration }}
 */
async function buildMaster({ src, info, ranges, gains, lightFilter, workDir, name, onProgress }) {
  const fps = info.fps;
  const snapped = snapRanges(ranges, fps);
  if (!snapped.length) throw new Error('Nothing left to keep in this part.');
  // Re-ordered parts ("edit my video my way"): each in-order run is built on its own, then joined losslessly.
  const inOrder = snapped.every((r, i) => i === 0 || r.start >= snapped[i - 1].end - 1e-6);
  if (!inOrder) return buildReordered({ src, info, snapped, ranges, gains, lightFilter, workDir, name, onProgress });
  const total = snapped.reduce((s, r) => s + (r.end - r.start), 0);
  const inside = insideExpr(snapped);
  const video = [
    `[0:v]fps=${fps}`,
    `select='${inside}'`,
    'setpts=N/FRAME_RATE/TB',
    ...(lightFilter ? [lightFilter] : []),
    'format=yuv420p[v]',
  ].join(',');
  const audioIn = info.hasAudio ? '[0:a]' : '[1:a]';
  const audio = [
    `${audioIn}aresample=48000`,
    ...(info.hasAudio && gains ? [`volume=eval=frame:volume='${gainExpr(snapped, gains)}'`] : []),
    `aselect='${inside}'`,
    'asetpts=N/SR/TB',
    'aformat=sample_fmts=s16:channel_layouts=stereo[a]',
  ].join(',');
  const script = path.join(workDir, `${name}.filter.txt`);
  fs.writeFileSync(script, `${video};\n${audio}`);
  const out = path.join(workDir, `${name}.master.mkv`);
  const args = ['-i', src];
  if (!info.hasAudio) args.push('-f', 'lavfi', '-t', String(info.duration || total + 1), '-i', 'anullsrc=r=48000:cl=stereo');
  args.push('-filter_complex_script', script, '-map', '[v]', '-map', '[a]',
    // Lossless in between: the only quality-losing encode is the final one.
    '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-c:a', 'pcm_s16le', '-r', String(fps), out);
  await ffmpeg(args, { totalSeconds: total, onProgress, timeoutMs: 12 * 3600000 });
  return { file: out, duration: total, ranges: snapped };
}

/** Parts in a new order: build each in-order run, then join them (stream copy - no quality loss). */
async function buildReordered({ src, info, snapped, gains, lightFilter, workDir, name, onProgress }) {
  const runs = [];
  snapped.forEach((r, i) => {
    const last = runs[runs.length - 1];
    if (last && r.start >= last.ranges[last.ranges.length - 1].end - 1e-6) { last.ranges.push(r); last.gains.push(gains?.[i] ?? 0); } else runs.push({ ranges: [r], gains: [gains?.[i] ?? 0] });
  });
  const total = snapped.reduce((s, r) => s + (r.end - r.start), 0);
  let done = 0;
  const pieces = [];
  for (const [i, run] of runs.entries()) {
    const len = run.ranges.reduce((s, r) => s + (r.end - r.start), 0);
    const piece = await buildMaster({
      src, info, ranges: run.ranges, gains: gains ? run.gains : null, lightFilter, workDir, name: `${name}-run${i}`,
      onProgress: onProgress ? (f) => onProgress((done + f * len) / total) : null,
    });
    done += len;
    pieces.push(piece.file);
  }
  const list = path.join(workDir, `${name}.concat.txt`);
  fs.writeFileSync(list, pieces.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const out = path.join(workDir, `${name}.master.mkv`);
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { timeoutMs: 2 * 3600000 });
  for (const p of pieces) fs.rmSync(p, { force: true });
  return { file: out, duration: total, ranges: snapped };
}

/** Map a word's time in the original to its time in the cut part (null when it was cut out). */
function mapTime(t, ranges) {
  let offset = 0;
  for (const r of ranges) {
    if (t >= r.start && t < r.end) return offset + (t - r.start);
    offset += r.end - r.start;
  }
  return null;
}

/** The words that survive the cut, on the new timeline. */
function wordsOnNewTimeline(words, ranges) {
  const out = [];
  for (const w of words) {
    const s = mapTime(Math.max(w.start, 0), ranges);
    const eRaw = mapTime(Math.max(w.end - 0.001, w.start), ranges);
    if (s === null) continue;
    out.push({ text: w.text, start: +s.toFixed(3), end: +(eRaw === null ? s + 0.25 : eRaw + 0.001).toFixed(3) });
  }
  return out.sort((a, b) => a.start - b.start); // re-ordered parts: in playing order
}

module.exports = { snapRanges, lightPlan, voiceGains, buildMaster, mapTime, wordsOnNewTimeline, gainExpr, insideExpr };
