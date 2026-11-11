const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const api = require('./api');
const media = require('./media');
const edit = require('./edit');
const graphics = require('./graphics');
const voice = require('./voice');
const safeBrowser = require('./safeBrowser');
const { buildScenes } = require('./websiteScenes');
const { exportVideo } = require('./exporter');
const { ffmpeg } = require('./run');
const { outputSize } = require('./framing');

/**
 * The two planned modes. Each runs twice:
 *   plan   - work out a plan (and save what the render needs to the job's
 *            work folder), send it for the business's approval, let go;
 *   render - after "Approve": carry out exactly that plan, then Jam's finish
 *            (captions, intro, call to action, top-quality export, test clip).
 */

const ASPECT = { instagram: '9x16', tiktok: '9x16', youtube: '16x9' };
const slug = (s) => String(s || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) || 'video';
const baseName = (name) => String(name || 'video').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'video';

async function saveWork(job, file, name, contentType) {
  const { url } = await api.call(`/jobs/${job.id}/upload`, { name, contentType, area: 'work' });
  await api.upload(url, file, contentType);
  return name;
}

async function fetchWork(job, name, dir) {
  const url = job.files?.[name];
  if (!url) throw new Error(`A file from the planning step is missing (${name}). Choose "Change it" to plan again.`);
  const out = path.join(dir, name);
  await api.download(url, out);
  return out;
}

async function submitPlan(job, plan, files, notes = []) {
  const r = await api.call(`/jobs/${job.id}/submit-plan`, { plan, files, notes });
  return { submitted: true, canceled: !!r.canceled };
}

// ---------------------------------------------------------------------------
// Make a video of my website
// ---------------------------------------------------------------------------

async function websitePlan(job, workDir, report) {
  const req = job.request || {};
  const aspect = ASPECT[job.answers?.platform] || '9x16';
  let creds = null;
  if (req.needsLogin) {
    if (!job.login) throw new Error('The website log in details are no longer available (the server restarted or the job was retried). Please enter them again.');
    try {
      creds = require('./loginKey').open(job.login);
    } catch {
      throw new Error('The website log in details were locked for a different run of the video editor. Please enter them again.');
    }
  }
  job.login = null; // the sealed copy is not needed any more
  await report('explore', 3, `Opening ${req.url}`);
  const shots = path.join(workDir, 'site');
  fs.mkdirSync(shots, { recursive: true });
  const found = await safeBrowser.explore({
    startUrl: req.url, aspect, dir: shots, creds, loginUrl: req.loginUrl || null, maxPages: 8,
    onProgress: (m) => report.soft('explore', 10, m),
  });
  creds = null;
  if (!found.pages.length) throw new Error(`The website couldn't be explored. ${found.notes.join(' ')}`);

  await report('explore', 40, `Saving ${found.pages.length} page(s)`);
  const files = [];
  const thumbFiles = {};
  for (const pg of found.pages) {
    files.push(await saveWork(job, path.join(shots, pg.shot), pg.shot, 'image/png'));
    files.push(await saveWork(job, path.join(shots, pg.thumb), pg.thumb, 'image/jpeg'));
    thumbFiles[pg.p] = pg.thumb;
    for (const c of pg.clicks) files.push(await saveWork(job, path.join(shots, c.shot), c.shot, 'image/png'));
  }

  await report('planning', 60, 'Planning the walkthrough and writing the voiceover');
  const thumbs = found.pages.slice(0, 10).map((pg) => ({ p: pg.p, base64: fs.readFileSync(path.join(shots, pg.thumb)).toString('base64') }));
  const pages = found.pages.map(({ p, url, title, headings, text, clicks }) => ({ p, url, title, headings, text, clicks: clicks.map(({ c, label }) => ({ c, label })) }));
  const plan = await api.call(`/jobs/${job.id}/plan-website`, { pages, thumbs, notes: found.notes });
  // What the render needs (screens, click positions) travels with the plan.
  plan.pages = found.pages.map(({ p, url, title, shot, width, height, scale, clicks }) => ({ p, url, title, shot, width, height, scale, clicks: clicks.map(({ c, label, box, scrollY, shot: s }) => ({ c, label, box, scrollY, shot: s })) }));
  plan.thumbFiles = thumbFiles;
  plan.aspect = aspect;
  plan.voice = req.voice;
  return submitPlan(job, plan, files, found.notes);
}

async function websiteRender(job, workDir, report) {
  const plan = job.plan;
  const answers = job.answers || {};
  const brand = job.brand || { colors: [], font: null, broll: [] };
  const aspect = plan.aspect || ASPECT[answers.platform] || '9x16';
  const size = aspect === '9x16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const fps = 30;
  const notes = [...(plan.notes || [])];
  if (!voice.ready()) throw new Error('The free voice model is not installed on the video editor - run "npm run setup" in the worker folder.');

  // Screens used by the scenes.
  await report('download', 3, 'Getting the website screenshots');
  const used = new Set();
  for (const sc of plan.scenes) {
    const pg = plan.pages.find((x) => x.p === sc.page);
    if (!pg) continue;
    used.add(pg.shot);
    if (sc.show === 'click') { const c = pg.clicks.find((x) => x.c === sc.click); if (c) used.add(c.shot); }
  }
  const assetsDir = path.join(workDir, 'assets-src');
  fs.mkdirSync(assetsDir, { recursive: true });
  const extraFiles = [];
  for (const name of used) extraFiles.push(await fetchWork(job, name, assetsDir));

  // Free voiceover, scene by scene; scenes last as long as their sentence (+ a breath).
  await report('voice', 15, `Voice: ${plan.voice || 'default'}`);
  const scenes = [];
  const words = [];
  const voiceParts = [];
  let t = 0;
  for (const [i, sc] of plan.scenes.entries()) {
    const wav = path.join(workDir, `voice${i}.wav`);
    const { seconds } = voice.speak(sc.narration, plan.voice, wav);
    const lead = 0.25;
    const duration = Math.max(2.6, seconds + lead + 0.4);
    scenes.push({ ...sc, start: t, duration });
    words.push(...voice.wordTimes(sc.narration, t + lead, seconds));
    voiceParts.push({ wav, delay: lead, duration });
    t += duration;
    report.soft('voice', 15 + ((i + 1) / plan.scenes.length) * 15);
  }
  const tail = 2.8; // the call-to-action card after the last sentence
  scenes[scenes.length - 1].duration += tail;
  const total = t + tail;

  // The voice track: each sentence placed at its scene, then silence to the end.
  const voiceWav = path.join(workDir, 'voice.wav');
  const inputs = voiceParts.flatMap((v) => ['-i', v.wav]);
  const chain = voiceParts.map((v, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(v.delay * 1000)}:all=1,apad=whole_dur=${v.duration.toFixed(3)}[v${i}]`).join(';');
  await ffmpeg([...inputs, '-filter_complex', `${chain};${voiceParts.map((_, i) => `[v${i}]`).join('')}concat=n=${voiceParts.length}:v=0:a=1,apad=whole_dur=${total.toFixed(3)}[a]`, '-map', '[a]', '-c:a', 'pcm_s16le', voiceWav]);

  // Scenes + captions + intro + call to action, rendered on this machine.
  await report('scenes', 32, 'Rendering the website scenes and captions');
  const accent = brand.colors?.[0] || '#E4572E';
  const sceneParts = buildScenes({ scenes, pages: plan.pages.map((pg) => ({ ...pg, shot: pg.shot })), W: size.width, H: size.height, accent });
  const captions = answers.style !== 'clean';
  const r = await graphics.renderOverlay({
    workDir, name: 'website', width: size.width, height: size.height, fps, duration: total,
    words: captions ? words : [], brand, businessName: job.businessName, cta: answers.cta, captions,
    scenes: sceneParts, extraFiles, opaque: true,
  });

  // Picture + voice -> master, then Jam's finish.
  const master = path.join(workDir, 'website.master.mkv');
  await ffmpeg(['-i', r.file, '-i', voiceWav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', '-shortest', master]);
  const info = { width: size.width, height: size.height, fps, duration: total, hasAudio: true };
  const loudness = await media.loudnessStats(master).catch(() => null);
  const base = slug(plan.title || 'website_video');
  const outputs = [];

  await report('test_clip', 70);
  const testName = `${base}_test_7s.mp4`;
  const testFile = path.join(workDir, testName);
  await exportVideo({ master, info, width: size.width, height: size.height, loudness, out: testFile, maxSeconds: 7, totalSeconds: total });
  outputs.push({ ...(await upload(job, testFile, testName)), name: testName, role: 'test_clip', format: aspect, ...size, duration: 7, part: 0 });

  await report('export', 74, `${aspect === '9x16' ? '9:16' : '16:9'} at ${size.width}x${size.height}`);
  const outName = `${base}_${answers.platform || 'video'}_${aspect}.mp4`;
  const file = path.join(workDir, outName);
  await exportVideo({ master, info, width: size.width, height: size.height, loudness, out: file, totalSeconds: total, onProgress: (f) => report.soft('export', 74 + f * 20) });
  await report('upload', 95, outName);
  outputs.push({ ...(await upload(job, file, outName)), name: outName, role: 'video', format: aspect, ...size, duration: +total.toFixed(2), part: 0, partTitle: plan.title || null });

  notes.push(`${plan.scenes.length} scenes from ${new Set(plan.scenes.map((s) => s.page)).size} page(s), with a free voiceover (${plan.voice}).`);
  for (const c of plan.cant_do || []) notes.push(`Couldn't do: ${c}`);
  notes.push(`Exported at ${size.width}x${size.height}, ${fps} fps, H.264 High (CRF ${config.crf}, top quality) with 320 kbps sound.`);
  return { outputs, notes, parts: [{ title: plan.title || null, transcript: plan.scenes.map((s) => s.narration).join(' ') }], stats: { scenes: plan.scenes.length, seconds: +total.toFixed(1) } };
}

async function upload(job, file, name) {
  const { url, key } = await api.call(`/jobs/${job.id}/upload`, { name, contentType: 'video/mp4' });
  const { bytes } = await api.upload(url, file, 'video/mp4');
  return { key, bytes };
}

// ---------------------------------------------------------------------------
// Edit my video my way
// ---------------------------------------------------------------------------

async function getOriginal(job, workDir, report) {
  await report('download', 1, `Downloading ${job.originalName}`);
  const ext = (path.extname(job.originalName || '') || '.mp4').toLowerCase();
  const src = path.join(workDir, `original${ext}`);
  await api.download(job.originalUrl, src, { onProgress: (f) => report.soft('download', 1 + f * 7) });
  return src;
}

async function customPlan(job, workDir, report) {
  const req = job.request || {};
  const src = await getOriginal(job, workDir, report);
  await report('probe', 8);
  const info = await media.probe(src);
  await report('transcribe', 9, 'Listening to every word (this takes a while on a laptop)');
  const words = info.hasAudio ? await media.transcribe(src, workDir, { language: job.answers?.language || 'en', duration: info.duration }) : [];
  if (!words.length) throw new Error('No speech was found in the video, so there is nothing to plan your edit from. Try the automatic edit instead.');

  const files = [];
  const notes = [];
  let reference = null;
  const siteImages = [];
  if (req.referenceUrl) {
    await report('reference', 40, req.referenceUrl);
    const dir = path.join(workDir, 'ref');
    fs.mkdirSync(dir, { recursive: true });
    try {
      const aspect = ASPECT[job.answers?.platform] || '9x16';
      const r = await safeBrowser.referenceShots({ url: req.referenceUrl, aspect, dir, max: 3 });
      notes.push(...r.notes);
      for (const [i, pg] of r.pages.entries()) {
        // The top of each page, as a photo to show (cropped to the screen's shape).
        const name = `site-${i + 1}.jpg`;
        const crop = aspect === '9x16' ? 'crop=iw:min(ih\\,iw*16/9):0:0' : 'crop=iw:min(ih\\,iw*9/16):0:0';
        await ffmpeg(['-i', path.join(dir, pg.shot), '-vf', crop, '-q:v', '2', path.join(dir, name)]);
        files.push(await saveWork(job, path.join(dir, name), name, 'image/jpeg'));
        siteImages.push(name);
      }
      if (r.pages[0]) reference = { url: req.referenceUrl, title: r.pages[0].title, summary: r.pages.map((p) => p.headings.slice(0, 4).join(', ')).join(' / ') };
    } catch (err) {
      notes.push(`The reference website couldn't be opened (${String(err.message).split('\n')[0].slice(0, 100)}).`);
    }
  }

  await report('planning', 55, 'Turning your description into an edit plan');
  const kitImages = (job.brand?.broll || []).filter((b) => b.kind === 'image').map((b) => b.name);
  const plan = await api.call(`/jobs/${job.id}/plan-custom`, { words, duration: info.duration, images: [...kitImages, ...siteImages], reference });
  const wordsFile = path.join(workDir, 'words.json');
  fs.writeFileSync(wordsFile, JSON.stringify(words));
  files.push(await saveWork(job, wordsFile, 'words.json', 'application/json'));
  plan.siteImages = siteImages;
  return submitPlan(job, plan, files, notes);
}

async function customRender(job, workDir, report) {
  const plan = job.plan;
  const answers = job.answers || {};
  const brand = job.brand || { colors: [], font: null, broll: [] };
  const notes = [...(plan.notes || [])];
  const src = await getOriginal(job, workDir, report);
  await report('probe', 8);
  const info = await media.probe(src);
  const words = JSON.parse(fs.readFileSync(await fetchWork(job, 'words.json', workDir), 'utf8'));

  await report('light', 12, 'Checking the light');
  const lp = edit.lightPlan(await media.measureLight(src, info.duration).catch(() => null));
  if (lp.note) notes.push(lp.note);

  const ranges = plan.render?.ranges?.length ? plan.render.ranges : [{ start: 0, end: info.duration }];
  await report('audio', 15);
  const gains = info.hasAudio ? await edit.voiceGains(src, edit.snapRanges(ranges, info.fps)) : null;
  await report('cut', 20, plan.segments?.length > 1 ? `${plan.segments.length} parts, in your order` : null);
  const master = await edit.buildMaster({ src, info, ranges, gains, lightFilter: lp.filter, workDir, name: 'custom', onProgress: (f) => report.soft('cut', 20 + f * 15) });
  const loudness = info.hasAudio ? await media.loudnessStats(master.file).catch(() => null) : null;
  const newWords = edit.wordsOnNewTimeline(words, master.ranges);
  const at = (t) => edit.mapTime(t, master.ranges);

  // Titles, photos and zooms moved onto the edited timeline.
  const titles = (plan.render?.titles || []).map((x) => ({ ...x, start: at(x.start) })).filter((x) => x.start !== null);
  const zooms = (plan.render?.zooms || []).map((z) => {
    const s = at(z.start);
    const e = at(Math.max(z.start, z.end - 0.01));
    return s === null ? null : { start: s, end: e === null || e <= s ? s + 2 : e, scale: z.scale };
  }).filter(Boolean);

  const assetsDir = path.join(workDir, 'assets-src');
  fs.mkdirSync(assetsDir, { recursive: true });
  const siteFiles = [];
  for (const name of plan.siteImages || []) siteFiles.push(await fetchWork(job, name, assetsDir).catch(() => null));
  const fetched = await graphics.fetchAssets(path.join(workDir, 'kit'), brand);
  const fileFor = (image) => fetched.broll.find((b) => b.name === image)?.file || (plan.siteImages || []).includes(image) && image;
  const brollItems = (plan.render?.broll || []).map((b) => ({ file: fileFor(b.image), start: at(b.start), seconds: b.seconds })).filter((b) => b.file && b.start !== null);

  const captions = plan.captions !== false && answers.style !== 'clean';
  const graphicsWanted = captions || titles.length || brollItems.length || answers.style === 'captions';
  const aspects = answers.both_formats ? [...new Set([ASPECT[answers.platform] || '9x16', '9x16', '16x9'])] : [ASPECT[answers.platform] || '9x16'];
  const base = baseName(job.originalName);
  const outputs = [];
  for (const [ai, aspect] of aspects.entries()) {
    const size = outputSize({ inW: info.width, inH: info.height, aspect });
    const p0 = 40 + (ai * 55) / aspects.length;
    let overlay = null;
    if (graphicsWanted) {
      await report('graphics', p0, 'Captions, titles and photos');
      const r = await graphics.renderOverlay({
        workDir, name: `custom-${aspect}`, width: size.width, height: size.height, fps: info.fps, duration: master.duration,
        words: captions ? newWords : [], brand, businessName: job.businessName, cta: answers.cta, captions,
        assets: { ...fetched, dir: path.join(workDir, 'kit') }, titles, brollItems, extraFiles: siteFiles.filter(Boolean),
      });
      overlay = r.file;
    }
    if (ai === 0) {
      await report('test_clip', p0 + 10);
      const testName = `${base}_test_7s.mp4`;
      const testFile = path.join(workDir, testName);
      await exportVideo({ master: master.file, overlay, info, width: size.width, height: size.height, loudness, out: testFile, maxSeconds: 7, totalSeconds: master.duration, zooms });
      outputs.push({ ...(await upload(job, testFile, testName)), name: testName, role: 'test_clip', format: aspect, ...size, duration: Math.min(7, master.duration), part: 0 });
    }
    await report('export', p0 + 12, `${aspect === '9x16' ? '9:16' : '16:9'} at ${size.width}x${size.height}`);
    const outName = `${base}_my_edit_${answers.platform || 'video'}_${aspect}.mp4`;
    const file = path.join(workDir, outName);
    await exportVideo({ master: master.file, overlay, info, width: size.width, height: size.height, loudness, out: file, totalSeconds: master.duration, zooms, onProgress: (f) => report.soft('export', p0 + 12 + f * 30) });
    await report('upload', p0 + 45, outName);
    outputs.push({ ...(await upload(job, file, outName)), name: outName, role: 'video', format: aspect, ...size, duration: +master.duration.toFixed(2), part: 0 });
  }

  for (const s of plan.summary || []) notes.push(`Done: ${s}`);
  for (const c of plan.cant_do || []) notes.push(`Couldn't do: ${c}`);
  const first = outputs.find((o) => o.role === 'video');
  notes.push(`Exported at ${first.width}x${first.height}, ${info.fps} fps, H.264 High (CRF ${config.crf}, top quality) with 320 kbps sound.`);
  return { outputs, notes, parts: [{ title: null, transcript: newWords.map((w) => w.text).join(' ') }], stats: { seconds: +master.duration.toFixed(1) } };
}

module.exports = { websitePlan, websiteRender, customPlan, customRender };
