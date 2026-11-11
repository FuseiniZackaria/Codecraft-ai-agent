const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { run, ffmpeg } = require('./run');

/** What the video is: display size (after phone rotation), frame rate, length, audio. */
async function probe(file) {
  const { stdout } = await run(config.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  const info = JSON.parse(stdout);
  const v = (info.streams || []).find((s) => s.codec_type === 'video');
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) throw new Error("This file has no video picture in it.");
  const rotation = Math.abs(Number(v.tags?.rotate || (v.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation || 0)) % 180;
  const [num, den] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  let fps = den ? num / den : 30;
  if (!Number.isFinite(fps) || fps < 10 || fps > 120) fps = 30;
  const width = rotation === 90 ? Number(v.height) : Number(v.width);
  const height = rotation === 90 ? Number(v.width) : Number(v.height);
  const duration = Number(info.format?.duration || v.duration || 0);
  return {
    width, height, rotation,
    fps: Math.min(60, Math.round(fps * 1000) / 1000),
    duration,
    hasAudio: !!a,
    pixFmt: v.pix_fmt || null,
    codec: v.codec_name || null,
    hdr: /bt2020|smpte2084|arib-std-b67/.test(`${v.color_primaries} ${v.color_transfer}`),
  };
}

/**
 * How bright the picture is (average 0-255, sampled every 2 s) - for fixing
 * dark footage and for an honest "reshoot" verdict.
 */
async function measureLight(file, duration) {
  const step = duration > 600 ? 10 : 2;
  const { stderr } = await ffmpeg(['-i', file, '-an', '-vf', `fps=1/${step},scale=320:-2,format=yuv420p,signalstats,metadata=print:key=lavfi.signalstats.YAVG`, '-f', 'null', '-'], { timeoutMs: 30 * 60000 });
  const values = [...stderr.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite);
  if (!values.length) return null;
  values.sort((x, y) => x - y);
  return { average: values.reduce((s, x) => s + x, 0) / values.length, darkest: values[Math.floor(values.length * 0.1)], samples: values.length };
}

/** Loudness (mean volume, dB) of one stretch of the audio. */
async function meanVolume(file, start, end) {
  const { stderr } = await ffmpeg(['-ss', String(start), '-to', String(end), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { timeoutMs: 5 * 60000 });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  return m ? Number(m[1]) : null;
}

/** Integrated loudness for the final two-pass normalisation (EBU R128). */
async function loudnessStats(file) {
  const { stderr } = await ffmpeg(['-i', file, '-vn', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { timeoutMs: 60 * 60000 });
  const m = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]);
  const ok = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].every((k) => Number.isFinite(Number(j[k])));
  return ok && Number(j.input_i) > -70 ? j : null;
}

/**
 * Word-level transcript with HyperFrames' free, local Whisper (never the
 * HeyGen engine: --engine whisper is always passed). Returns
 * [{ text, start, end }] in seconds, or [] when nothing was said.
 */
async function transcribe(file, workDir, { language = 'en', duration = 0 } = {}) {
  const project = path.join(workDir, 'transcript-project');
  fs.mkdirSync(project, { recursive: true });
  const audio = path.join(workDir, 'speech.wav');
  await ffmpeg(['-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio], { timeoutMs: 60 * 60000 });
  const english = language === 'en';
  const model = english ? config.whisperModel : (process.env.WHISPER_MODEL_MULTI || 'small');
  const args = [config.hyperframesBin, 'transcribe', audio, '--dir', project, '--engine', 'whisper', '--model', model, '--json'];
  if (!english || model.endsWith('.en')) args.push('--language', language);
  // Slow laptops: allow plenty of time (about 4x the audio length, at least 10 minutes).
  const timeoutMs = Math.max(10 * 60000, Math.round(duration * 4000));
  const { stdout } = await run(process.execPath, args, { cwd: project, env: require('./config').childEnv({ HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS: String(timeoutMs) }), timeoutMs: timeoutMs + 120000 });
  let summary = null;
  try { summary = JSON.parse(stdout.trim().split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop() || 'null'); } catch { /* read the file below */ }
  if (summary && summary.ok === false) {
    throw new Error(summary.reason === 'whisper_unavailable'
      ? 'Local Whisper is not installed - run "npm run setup" in the worker folder.'
      : `Transcription failed: ${summary.reason || summary.error || 'unknown reason'}`);
  }
  const candidates = [summary?.path, summary?.transcript, path.join(project, 'assets', 'transcript.json')].filter((p) => typeof p === 'string');
  const file2 = candidates.map((p) => (path.isAbsolute(p) ? p : path.join(project, p))).find((p) => fs.existsSync(p));
  if (!file2) throw new Error('Transcription finished but wrote no transcript.');
  return wordsFrom(JSON.parse(fs.readFileSync(file2, 'utf8')));
}

/** Whatever shape the transcript JSON has, a flat list of { text, start, end }. */
function wordsFrom(json) {
  const list = Array.isArray(json) ? json
    : Array.isArray(json?.words) ? json.words
      : Array.isArray(json?.segments) ? json.segments.flatMap((s) => (Array.isArray(s.words) ? s.words : []))
        : Array.isArray(json?.transcript) ? json.transcript : [];
  return list.map((w) => ({ text: String(w.text ?? w.word ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));
}

module.exports = { probe, measureLight, meanVolume, loudnessStats, transcribe, wordsFrom };
