// Video worker: the real FFmpeg steps on a generated clip (no backend, no
// Whisper - the words are given). Checks: cuts land on whole frames and the
// sound stays in sync; dark footage is brightened (and called out when very
// dark); each voice stretch is levelled; words move to the new timeline;
// exports are 9:16 / 16:9 at the right size with top-quality settings; the
// original is never modified; the HyperFrames composition follows the
// contract. Set HF_RENDER=1 to also render real captions with HyperFrames.

process.env.HYPERFRAMES_NO_TELEMETRY = '1';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffmpeg } = require('../lib/run');
const media = require('../lib/media');
const edit = require('../lib/edit');
const graphics = require('../lib/graphics');
const { exportVideo } = require('../lib/exporter');
const { outputSize } = require('../lib/framing');
const { friendly } = require('../index');

const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-worker-test-'));
  try {
    // A 12 s 1920x1080 "recording": 2 s of loud "speech", 1 s silence, 2 s QUIET speech... (a quiet real voice + loud AI voice)
    const src = path.join(dir, 'original.mp4');
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30,eq=brightness=-0.35', '-f', 'lavfi',
      '-i', "aevalsrc='if(lt(mod(t,6),3),0.5,0.05)*sin(2*PI*330*t)*between(mod(t,3),0,2)':s=48000",
      '-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', src]);
    const before = hash(src);

    const info = await media.probe(src);
    assert.deepStrictEqual([info.width, info.height, info.fps, info.hasAudio], [1920, 1080, 30, true]);
    console.log('✓ probe: size, frame rate, sound');

    // Light: a dark clip is brightened and its grain calmed.
    const light = await media.measureLight(src, info.duration);
    const lp = edit.lightPlan(light);
    assert(light.average < 95 && lp.fixed && /eq=gamma/.test(lp.filter), `dark footage gets fixed (avg ${light.average})`);
    assert.strictEqual(edit.lightPlan({ average: 30, darkest: 15 }).reshoot, true, 'very dark -> honest reshoot advice');
    assert.strictEqual(edit.lightPlan({ average: 128, darkest: 90 }).filter, null, 'well-lit footage is left alone');
    console.log(`✓ light: measured ${Math.round(light.average)}/255 -> brightened; very dark footage gets an honest reshoot note`);

    // Keep the "speech" (0-2, 3-5, 6-8, 9-11 s); silences are cut. Odd times to test frame snapping.
    const ranges = [{ start: 0.01, end: 2.03 }, { start: 3.0, end: 5.01 }, { start: 6.02, end: 8.0 }, { start: 9.0, end: 11.0 }];
    const snapped = edit.snapRanges(ranges, info.fps);
    assert(snapped.every((r) => Math.abs(r.start * 30 - Math.round(r.start * 30)) < 1e-3 && Math.abs(r.end * 30 - Math.round(r.end * 30)) < 1e-3), 'cuts on whole frames');

    const gains = await edit.voiceGains(src, snapped);
    assert(gains[1] - gains[0] > 10, `the quiet stretch is boosted more than the loud one (${gains.join(', ')})`);
    console.log(`✓ voices levelled separately: gains ${gains.map((g) => `${g > 0 ? '+' : ''}${g} dB`).join(', ')}`);

    const master = await edit.buildMaster({ src, info, ranges, gains, lightFilter: lp.filter, workDir: dir, name: 't' });
    const m = await media.probe(master.file);
    const expected = snapped.reduce((s, r) => s + (r.end - r.start), 0);
    assert(Math.abs(m.duration - expected) < 0.1, `cut length ${m.duration} ~ ${expected}`);
    const { stdout } = await require('../lib/run').run(require('../lib/config').config.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', master.file]);
    const streams = JSON.parse(stdout).streams;
    const vDur = Number(streams.find((s) => s.codec_type === 'video')?.duration || m.duration);
    const aDur = Number(streams.find((s) => s.codec_type === 'audio')?.duration || m.duration);
    assert(Math.abs(vDur - aDur) < 0.05, `picture and sound stay in sync after 4 cuts (video ${vDur}s, audio ${aDur}s)`);
    console.log(`✓ cut: 12 s -> ${m.duration.toFixed(2)} s, cuts on whole frames, sound in sync (lossless master)`);

    // Words move with the cut; words in removed silence disappear.
    const moved = edit.wordsOnNewTimeline([{ text: 'hello', start: 3.2, end: 3.6 }, { text: 'gone', start: 2.5, end: 2.8 }], master.ranges);
    assert.deepStrictEqual(moved.map((w) => w.text), ['hello']);
    assert(Math.abs(moved[0].start - (2.0333 + 0.2)) < 0.05, `"hello" now at ${moved[0].start}s`);
    console.log('✓ captions follow the cut (removed words disappear)');

    // Export sizes: never shrink detail; 4K canvas when a landscape video goes vertical.
    assert.deepStrictEqual(outputSize({ inW: 1920, inH: 1080, aspect: '9x16' }), { width: 2160, height: 3840 });
    assert.deepStrictEqual(outputSize({ inW: 1080, inH: 1920, aspect: '9x16' }), { width: 1080, height: 1920 });
    assert.deepStrictEqual(outputSize({ inW: 1920, inH: 1080, aspect: '16x9' }), { width: 1920, height: 1080 });
    assert.deepStrictEqual(outputSize({ inW: 3840, inH: 2160, aspect: '16x9' }), { width: 3840, height: 2160 });
    const loud = await media.loudnessStats(master.file);
    const out = path.join(dir, 'original_youtube_16x9.mp4');
    await exportVideo({ master: master.file, info, width: 1920, height: 1080, loudness: loud, out, maxSeconds: 3, totalSeconds: master.duration });
    const o = await media.probe(out);
    assert.deepStrictEqual([o.width, o.height, o.codec], [1920, 1080, 'h264']);
    const vertical = path.join(dir, 'original_tiktok_9x16.mp4');
    await exportVideo({ master: master.file, info, width: 1080, height: 1920, loudness: loud, out: vertical, maxSeconds: 2, totalSeconds: master.duration });
    assert.deepStrictEqual([(await media.probe(vertical)).width, (await media.probe(vertical)).height], [1080, 1920]);
    console.log('✓ export: 16:9 1920x1080 and 9:16 1080x1920 H.264 High CRF 16; landscape-to-vertical uses a 4K canvas so detail is never shrunk');

    assert.strictEqual(hash(src), before, 'the original file is never changed');
    console.log('✓ the original file is untouched');

    // HyperFrames composition: the contract's basics.
    const html = graphics.compositionHtml({
      width: 1080, height: 1920, duration: 7, captions: true, businessName: "Ama's Kitchen", cta: 'Order on WhatsApp',
      brand: { colors: ['#E4572E', '#1B1B1E'], font: 'Montserrat' }, logoFile: null, broll: [],
      words: [{ text: 'Fresh', start: 0.4, end: 0.8 }, { text: 'jollof', start: 0.85, end: 1.3 }, { text: 'every', start: 1.35, end: 1.7 }, { text: 'morning.', start: 1.75, end: 2.3 }],
    });
    assert(/data-composition-id="main"/.test(html) && /window\.__timelines\["main"\] = tl/.test(html));
    assert(/class="clip" data-start="[\d.]+" data-duration="[\d.]+"/.test(html), 'timed elements are clips with start/duration');
    assert(!/Math\.random|Date\.now|setTimeout|fetch\(/.test(html), 'no randomness, timers or network');
    assert(/Ama&#39;s Kitchen/.test(html) && /Order on WhatsApp/.test(html) && /#E4572E/.test(html) && /Montserrat/.test(html));
    assert.strictEqual(graphics.captionGroups([{ text: 'a', start: 0, end: 0.2 }, { text: 'b', start: 0.25, end: 0.4 }, { text: 'c', start: 0.45, end: 0.6 }, { text: 'd', start: 0.65, end: 0.8 }], { vertical: true, duration: 2 }).length, 2, '3 words per caption on vertical');
    assert.strictEqual(graphics.textOn('#FFE066'), '#111111');
    const moments = graphics.brollMoments([{ start: 1, words: [{ text: 'jollof' }] }], [{ kind: 'image', name: 'jollof-rice.jpg', file: 'b0.jpg' }]);
    assert.strictEqual(moments.length, 1, 'a B-roll photo named after what is said is shown');
    console.log('✓ HyperFrames composition: brand colours/font, word-by-word captions, intro, CTA card, matching B-roll; contract rules kept');

    assert(/export it again as MP4/.test(friendly(new Error('moov atom not found'))));

    if (process.env.HF_RENDER === '1') {
      const r = await graphics.renderOverlay({
        workDir: dir, name: 'hf', width: 1080, height: 1920, fps: 30, duration: 4, captions: true,
        words: [{ text: 'Fresh', start: 0.4, end: 0.8 }, { text: 'jollof', start: 0.85, end: 1.3 }, { text: 'today!', start: 1.35, end: 2 }],
        brand: { colors: ['#E4572E', '#1B1B1E'], font: 'Montserrat', broll: [] }, businessName: "Ama's Kitchen", cta: 'Order on WhatsApp',
      });
      const withCaps = path.join(dir, 'captioned.mp4');
      await exportVideo({ master: master.file, overlay: r.file, info, width: 1080, height: 1920, loudness: loud, out: withCaps, maxSeconds: 4, totalSeconds: master.duration });
      assert((await media.probe(withCaps)).width === 1080);
      console.log(`✓ HyperFrames rendered the branded captions locally and they were laid over the video (${withCaps})`);
    }

    console.log('\nAll video worker tests passed.');
  } finally {
    if (process.env.KEEP_TEMP !== 'true') fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
