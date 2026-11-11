#!/usr/bin/env node
/**
 * CodeCraft video editor worker.
 *
 * Checks in with the backend every 15 s (so the app knows the editor is
 * online), takes one video job at a time, edits it (lib/pipeline.js) and
 * uploads the results. The same code runs on a laptop (`npm start`) or as a
 * Render background worker (Dockerfile) - only the environment differs.
 *
 * Needs only BACKEND_URL and VIDEO_WORKER_TOKEN (worker/.env). No database,
 * storage or AI keys live here.
 */

const { config, problems } = require('./lib/config');
const api = require('./lib/api');
const { processJob } = require('./lib/pipeline');
const { cancelAll, CanceledError } = require('./lib/run');

let busy = false;
let stopping = false;
let currentJob = null;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function heartbeat() {
  try {
    const lk = require('./lib/loginKey'); // public key only: browsers seal website logins with it
    await api.call('/heartbeat', { version: config.version, platform: process.platform, busy, keyId: lk.keyId, publicKey: lk.publicKeyB64 }, { retries: 0 }); // the next check-in is 15 s away anyway
  } catch (err) {
    log(`! ${err.message}`);
  }
}

/** Progress reporter for one job: stage changes go out at once; percentages at most every 4 s. */
function reporter(job) {
  let last = 0;
  let stage = 'download';
  let pct = 0;
  let canceled = false;
  const send = async (s, p, message) => {
    const r = await api.call(`/jobs/${job.id}/progress`, { stage: s, progress: p, message: message || undefined }, { retries: 1 }).catch((err) => { log(`! progress not sent: ${err.message}`); return {}; });
    if (r.canceled) { canceled = true; cancelAll(); }
  };
  const report = async (s, p, message = null) => {
    if (canceled) throw new CanceledError();
    stage = s;
    pct = p;
    last = Date.now();
    log(`  ${s} ${Math.round(p)}%${message ? ` - ${message}` : ''}`);
    await send(s, p, message);
    if (canceled) throw new CanceledError();
  };
  // Frequent updates (encode progress): throttled, never awaited.
  report.soft = (s, p) => {
    stage = s;
    pct = p;
    if (Date.now() - last < 4000) return;
    last = Date.now();
    send(s, p);
  };
  // Keep the job's heartbeat fresh during long steps (a quiet job is put back in the queue after 10 min).
  report.timer = setInterval(() => { if (Date.now() - last > 60000) { last = Date.now(); send(stage, pct); } }, 30000);
  return report;
}

async function work() {
  if (busy || stopping) return;
  busy = true;
  try {
    const lk = require('./lib/loginKey');
    const { job } = await api.call('/claim', { version: config.version, platform: process.platform, keyId: lk.keyId, publicKey: lk.publicKeyB64 });
    if (!job) return;
    currentJob = job;
    log(`> job ${job.id} (${job.kind}${job.originalName ? `: ${job.originalName}` : ''})`);
    const report = reporter(job);
    const started = Date.now();
    try {
      const result = await processJob(job, report);
      if (result?.submitted) {
        log(`< plan sent for approval${result.canceled ? ' (but the job was canceled)' : ''} after ${Math.round((Date.now() - started) / 60000)} min`);
        return;
      }
      await report('post_text', 99, 'Writing the post caption and hashtags');
      await api.call(`/jobs/${job.id}/complete`, result);
      log(`< done in ${Math.round((Date.now() - started) / 60000)} min: ${result.outputs.map((o) => o.name).join(', ')}`);
    } catch (err) {
      if (err instanceof CanceledError || err.name === 'CanceledError') {
        log('< canceled by the user');
      } else {
        log(`< failed: ${err.message}`);
        await api.call(`/jobs/${job.id}/fail`, { error: friendly(err) }).catch(() => {});
      }
    } finally {
      clearInterval(report.timer);
    }
  } catch (err) {
    log(`! ${err.status === 401 ? 'the backend refused the worker token - check VIDEO_WORKER_TOKEN matches Render' : err.message}`);
  } finally {
    busy = false;
    currentJob = null;
  }
}

/** What the business sees when something goes wrong: short and useful, no internals. */
function friendly(err) {
  const m = String(err.message || err);
  if (/no video picture|Invalid data found|moov atom not found/i.test(m)) return "The file couldn't be read as a video. Please export it again as MP4 or MOV and upload that.";
  if (/took too long/i.test(m)) return 'This video took too long to edit on the video editor. Try a shorter video, or try again.';
  if (/npm run setup/i.test(m)) return `The video editor is missing a part (${/voice/i.test(m) ? 'the free voice' : 'local Whisper'}) - the owner needs to run "npm run setup" on it.`;
  if (/log ?in details|No speech|couldn't be explored|private or local network/i.test(m)) return m.slice(0, 400); // already plain words
  return `The video editor hit a problem: ${m.slice(0, 300)}`;
}

async function main() {
  const missing = problems();
  if (missing.length) {
    console.error(`Can't start the video worker:\n - ${missing.join('\n - ')}\nEdit worker/.env (copy worker/.env.example) and try again.`);
    process.exit(1);
  }
  log(`CodeCraft video worker ${config.version} (${config.workerId}) -> ${config.backendUrl}`);
  log(`quality: H.264 CRF ${config.crf} ${config.preset}, AAC ${config.audioBitrate}; whisper: ${config.whisper ? 'ready' : 'not installed (npm run setup)'}`);
  await heartbeat();
  setInterval(heartbeat, config.heartbeatMs).unref();
  setInterval(work, config.pollMs);
  work();
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: stopping${currentJob ? ` (job ${currentJob.id} goes back in the queue and starts again later)` : ''}`);
  cancelAll();
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) main();

module.exports = { friendly, work };
