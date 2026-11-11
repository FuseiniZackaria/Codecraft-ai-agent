const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const api = require('./api');
const media = require('./media');
const edit = require('./edit');
const graphics = require('./graphics');
const { exportVideo } = require('./exporter');
const { ffmpeg } = require('./run');
const { outputSize } = require('./framing');

/**
 * One job, start to finish (Jam's workflow):
 *   1. get a COPY of the original (the original in storage is never changed)
 *   2. transcribe it word by word (free local Whisper)
 *   3. find retakes, pauses over 0.5 s and separate videos (backend: rules + AI)
 *   4. fix light/grain, level each voice stretch, cut -> lossless master per part
 *   5. branded captions + graphics (HyperFrames, local), if asked
 *   6. a 7-second test clip first (proof it works), then the full export
 *      at top quality in 9:16 and/or 16:9
 *   7. upload as new files next to the original; report honest notes
 */

const ASPECTS = { instagram: ['9x16'], tiktok: ['9x16'], youtube: ['16x9'] };
const PLATFORM_LABEL = { instagram: 'instagram', tiktok: 'tiktok', youtube: 'youtube' };

function baseName(name) {
  return String(name || 'video').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'video';
}

async function processJob(job, report) {
  const workDir = path.join(config.workDir, job.id);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  try {
    if (job.kind === 'test_clip') return await testClip(job, workDir, report);
    // The two planned modes: plan (then wait for approval) or render the approved plan.
    const modes = require('./modes');
    if (job.mode === 'website') return job.phase === 'render' ? await modes.websiteRender(job, workDir, report) : await modes.websitePlan(job, workDir, report);
    if (job.mode === 'custom') return job.phase === 'render' ? await modes.customRender(job, workDir, report) : await modes.customPlan(job, workDir, report);
    return await editJob(job, workDir, report);
  } finally {
    if (!config.keepTemp) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function uploadOutput(job, file, name, contentType = 'video/mp4', onProgress) {
  const { url, key } = await api.call(`/jobs/${job.id}/upload`, { name, contentType });
  const { bytes } = await api.upload(url, file, contentType, { onProgress });
  return { key, bytes };
}

async function editJob(job, workDir, report) {
  const answers = job.answers || {};
  const notes = [];
  const stats = {};
  const brand = job.brand || { colors: [], font: null, broll: [] };
  const captions = answers.style === 'captions';
  const aspects = answers.both_formats ? [...new Set([...(ASPECTS[answers.platform] || ['9x16']), '9x16', '16x9'])] : (ASPECTS[answers.platform] || ['9x16']);
  const base = baseName(job.originalName);

  // 1. A copy of the original to work on.
  await report('download', 1, `Downloading ${job.originalName}`);
  const ext = (path.extname(job.originalName || '') || '.mp4').toLowerCase();
  const src = path.join(workDir, `original${ext}`);
  await api.download(job.originalUrl, src, { onProgress: (f) => report.soft('download', 1 + f * 7) });

  await report('probe', 8);
  const info = await media.probe(src);
  stats.source = { width: info.width, height: info.height, fps: info.fps, duration: +info.duration.toFixed(2) };
  if (info.hdr) notes.push('Your video was recorded in HDR; it was converted to standard colour so it looks right on every phone.');

  // 2. What was said, word by word.
  await report('transcribe', 9, 'Listening to every word (this takes a while on a laptop)');
  let words = [];
  if (info.hasAudio) {
    words = await media.transcribe(src, workDir, { language: answers.language || 'en', duration: info.duration });
  }

  // 3. Retakes, pauses and separate videos.
  await report('plan', 25);
  let plan = null;
  if (words.length) plan = await api.call(`/jobs/${job.id}/plan`, { words, duration: info.duration });
  let parts;
  if (plan && plan.parts?.length) {
    parts = plan.parts;
    stats.retakesRemoved = plan.retakesRemoved;
    stats.pausesCut = plan.pausesCut;
    stats.secondsSaved = plan.secondsSaved;
    const bits = [];
    if (plan.retakesRemoved) bits.push(`removed ${plan.retakesRemoved} retake${plan.retakesRemoved === 1 ? '' : 's'} (kept the best take)`);
    if (plan.pausesCut) bits.push(`cut ${plan.pausesCut} pause${plan.pausesCut === 1 ? '' : 's'} longer than half a second`);
    notes.push(bits.length ? `I ${bits.join(' and ')}, ${plan.secondsSaved} seconds shorter in total.` : 'No retakes or long pauses to cut.');
    if (parts.length > 1) notes.push(`This recording had ${parts.length} separate videos in it, so I split it into ${parts.length} files.`);
  } else {
    parts = [{ title: null, ranges: [{ start: 0, end: info.duration }], duration: info.duration }];
    notes.push(info.hasAudio ? 'I found no speech, so nothing was cut and no captions were added.' : 'The video has no sound, so nothing was cut and no captions were added.');
  }

  // 4a. Light and grain (measured once on the original).
  await report('light', 28, 'Checking the light');
  const light = await media.measureLight(src, info.duration).catch(() => null);
  const lp = edit.lightPlan(light);
  if (lp.note) notes.push(lp.note);
  stats.light = light ? { average: Math.round(light.average), fixed: lp.fixed, reshoot: lp.reshoot } : null;

  const outputs = [];
  const partInfo = [];
  let sharedAssets = null;
  let testDone = false;
  const totalParts = parts.length;
  for (const [pi, part] of parts.entries()) {
    const span = 70 / totalParts; // 28..98 across parts
    const at = (f) => 28 + span * pi + span * f;
    const suffix = totalParts > 1 ? `_part${pi + 1}` : '';
    const name = `p${pi + 1}`;

    // 4b. Each stretch of voice levelled on its own (an AI voice and a real voice end up equally loud).
    await report('audio', at(0.02), totalParts > 1 ? `Part ${pi + 1} of ${totalParts}` : null);
    const gains = info.hasAudio ? await edit.voiceGains(src, edit.snapRanges(part.ranges, info.fps)) : null;

    // 4c. Cut + light + levels -> lossless master.
    await report('cut', at(0.08));
    const master = await edit.buildMaster({ src, info, ranges: part.ranges, gains, lightFilter: lp.filter, workDir, name, onProgress: (f) => report.soft('cut', at(0.08 + f * 0.17)) });
    const loudness = info.hasAudio ? await media.loudnessStats(master.file).catch(() => null) : null;
    const partWords = edit.wordsOnNewTimeline(words, master.ranges);

    for (const [ai, aspect] of aspects.entries()) {
      const size = outputSize({ inW: info.width, inH: info.height, aspect });
      const step = 0.75 / aspects.length;
      const a0 = 0.25 + step * ai;

      // 5. Captions and graphics.
      let overlay = null;
      if (captions) {
        await report('graphics', at(a0), 'Rendering branded captions and graphics');
        const r = await graphics.renderOverlay({
          workDir, name: `${name}-${aspect}`, width: size.width, height: size.height, fps: info.fps, duration: master.duration,
          words: partWords, brand, businessName: job.businessName, cta: answers.cta, captions: true, assets: sharedAssets,
        });
        overlay = r.file;
        sharedAssets = sharedAssets || r.assets;
      }

      // 6a. The 7-second test clip, first: proof it works before the long export.
      if (!testDone) {
        await report('test_clip', at(a0 + step * 0.4));
        const testFile = path.join(workDir, `${base}_test_7s.mp4`);
        await exportVideo({ master: master.file, overlay, info, width: size.width, height: size.height, loudness, out: testFile, maxSeconds: 7, totalSeconds: master.duration });
        const up = await uploadOutput(job, testFile, `${base}_test_7s.mp4`);
        outputs.push({ ...up, name: `${base}_test_7s.mp4`, role: 'test_clip', format: aspect, width: size.width, height: size.height, duration: Math.min(7, +master.duration.toFixed(2)), part: pi });
        testDone = true;
      }

      // 6b. The full export.
      await report('export', at(a0 + step * 0.45), `${aspect === '9x16' ? '9:16 vertical' : '16:9'} at ${size.width}x${size.height}`);
      const outName = `${base}${suffix}_${PLATFORM_LABEL[answers.platform] || 'video'}_${aspect}.mp4`;
      const file = path.join(workDir, outName);
      await exportVideo({
        master: master.file, overlay, info, width: size.width, height: size.height, loudness, out: file, totalSeconds: master.duration,
        onProgress: (f) => report.soft('export', at(a0 + step * (0.45 + f * 0.45))),
      });

      // 7. Saved as a new file next to the original.
      await report('upload', at(a0 + step * 0.92), outName);
      const up = await uploadOutput(job, file, outName);
      outputs.push({ ...up, name: outName, role: 'video', format: aspect, width: size.width, height: size.height, duration: +master.duration.toFixed(2), part: pi, partTitle: part.title || null });
      fs.rmSync(file, { force: true });
    }
    partInfo.push({ title: part.title || null, transcript: partWords.map((w) => w.text).join(' ') });
    fs.rmSync(master.file, { force: true });
  }

  if (info.hasAudio) notes.push('Each stretch of voice was levelled on its own, so a quiet voice and a loud (or AI) voice play at the same volume. Two people talking at the same moment can’t be separated.');
  const first = outputs.find((o) => o.role === 'video');
  notes.push(`Exported at ${first.width}x${first.height}, ${info.fps} fps, H.264 High (CRF ${config.crf}, top quality) with 320 kbps sound.`);
  return { outputs, notes, parts: partInfo, stats };
}

/** A 7-second clip with branded captions on a brand-colour background - proves the editor works. */
async function testClip(job, workDir, report) {
  const answers = job.answers || {};
  const brand = job.brand || { colors: ['#E4572E', '#1B1B1E'], font: 'Montserrat' };
  const aspect = (ASPECTS[answers.platform] || ['9x16'])[0];
  const info = { width: aspect === '9x16' ? 1080 : 1920, height: aspect === '9x16' ? 1920 : 1080, fps: 30, duration: 7, hasAudio: true };
  const size = { width: info.width, height: info.height };
  const [c1, c2] = brand.colors.length >= 2 ? brand.colors : ['#E4572E', '#1B1B1E'];

  await report('test_clip', 10, 'Making the background');
  const master = path.join(workDir, 'test.master.mkv');
  await ffmpeg(['-f', 'lavfi', '-i', `gradients=s=${size.width}x${size.height}:c0=0x${c2.slice(1)}:c1=0x${c1.slice(1)}:duration=7:speed=0.015:rate=30`,
    '-f', 'lavfi', '-t', '7', '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-t', '7', master]);

  const sentence = `This is your seven second test clip with branded captions${job.businessName ? ` for ${job.businessName}` : ''}`.split(' ');
  const per = 5.2 / sentence.length;
  const words = sentence.map((text, i) => ({ text, start: +(0.4 + i * per).toFixed(3), end: +(0.4 + (i + 1) * per - 0.03).toFixed(3) }));

  await report('graphics', 30, 'Rendering branded captions with HyperFrames');
  const { file: overlay } = await graphics.renderOverlay({
    workDir, name: 'test', width: size.width, height: size.height, fps: 30, duration: 7,
    words, brand, businessName: job.businessName, cta: answers.cta || 'Follow for more', captions: true,
  });

  await report('export', 75);
  const outName = `test_7s_${answers.platform || 'tiktok'}_${aspect}.mp4`;
  const file = path.join(workDir, outName);
  await exportVideo({ master, overlay, info, width: size.width, height: size.height, out: file, totalSeconds: 7 });

  await report('upload', 92);
  const up = await uploadOutput(job, file, outName);
  return {
    outputs: [{ ...up, name: outName, role: 'test_clip', format: aspect, width: size.width, height: size.height, duration: 7, part: 0 }],
    notes: [`Test clip made with your brand colours (${c1}, ${c2}) and font (${brand.font || 'Montserrat'}), rendered on the video editor with HyperFrames.`],
    parts: [],
    stats: {},
  };
}

module.exports = { processJob, baseName };
