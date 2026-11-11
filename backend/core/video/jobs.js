const crypto = require('crypto');
const config = require('../../config');
const storage = require('./storage');

/**
 * Video jobs (migration 0011, table video_jobs): upload -> queued -> the
 * worker edits it -> done (files in R2) -> deleted after VIDEO_KEEP_DAYS.
 *
 * Every read and change takes the business (workspace) id, so one business
 * never sees another's jobs. The worker side (claim, progress, finish) is
 * keyed by the worker's id instead and only reaches jobs it claimed.
 */

const KEEP_DAYS = Math.max(1, Number(process.env.VIDEO_KEEP_DAYS) || 14);
const STORAGE_LIMIT_BYTES = Math.round((Number(process.env.VIDEO_STORAGE_LIMIT_GB) || 8) * 1024 ** 3); // stays under R2's free 10 GB
const PER_BUSINESS_LIMIT_BYTES = Math.round((Number(process.env.VIDEO_STORAGE_PER_BUSINESS_GB) || 3) * 1024 ** 3);
const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
const STALE_MINUTES = 10; // a job whose worker went quiet this long goes back in the queue
const MAX_ATTEMPTS = 2;

const STAGES = {
  waiting: 'Waiting for the video editor',
  explore: 'Exploring the website',
  planning: 'Writing the plan',
  awaiting: 'Waiting for your approval',
  reference: 'Looking at the reference website',
  voice: 'Recording the voiceover',
  scenes: 'Building the website scenes',
  download: 'Getting your video',
  probe: 'Checking the video',
  transcribe: 'Transcribing',
  plan: 'Finding retakes and pauses',
  cut: 'Cutting retakes and pauses',
  light: 'Fixing light and grain',
  audio: 'Levelling the voices',
  test_clip: 'Making the 7-second test clip',
  graphics: 'Adding captions and graphics',
  export: 'Exporting in top quality',
  upload: 'Saving the finished video',
  post_text: 'Writing the post caption and hashtags',
  done: 'Done',
};

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}
const mem = { jobs: [] };
const now = () => new Date().toISOString();

function check(error, where) {
  if (!error) return;
  if (/does not exist|schema cache/i.test(error.message)) {
    const err = new Error('The video editor tables are missing - run backend/database/migrations/0011_video_editor.sql in Supabase (SQL Editor).');
    err.code = 'MIGRATION_MISSING';
    throw err;
  }
  throw new Error(`video jobs (${where}): ${error.message}`);
}

async function insert(row) {
  if (!db()) { mem.jobs.push({ ...row }); return { ...row }; }
  const { data, error } = await db().from('video_jobs').insert(row).select().single();
  check(error, 'insert');
  return data;
}

async function patch(id, fields, where = {}) {
  const full = { ...fields, updated_at: now() };
  if (!db()) {
    const j = mem.jobs.find((x) => x.id === id && Object.entries(where).every(([k, v]) => x[k] === v));
    if (!j) return null;
    Object.assign(j, full);
    return { ...j };
  }
  let q = db().from('video_jobs').update(full).eq('id', id);
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
  const { data, error } = await q.select().maybeSingle();
  check(error, 'update');
  return data;
}

async function get(id, workspaceId) {
  if (!id || !workspaceId) return null;
  if (!db()) { const j = mem.jobs.find((x) => x.id === id && x.workspace_id === workspaceId); return j ? { ...j } : null; }
  const { data, error } = await db().from('video_jobs').select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle();
  if (error && /invalid input syntax for type uuid/i.test(error.message)) return null;
  check(error, 'get');
  return data;
}

async function getForWorker(id, workerId) {
  if (!db()) { const j = mem.jobs.find((x) => x.id === id && x.worker_id === workerId); return j ? { ...j } : null; }
  const { data, error } = await db().from('video_jobs').select('*').eq('id', id).eq('worker_id', workerId).maybeSingle();
  if (error && /invalid input syntax for type uuid/i.test(error.message)) return null;
  check(error, 'getForWorker');
  return data;
}

async function list(workspaceId, limit = 30) {
  if (!db()) return mem.jobs.filter((j) => j.workspace_id === workspaceId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit).map((j) => ({ ...j }));
  const { data, error } = await db().from('video_jobs').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(limit);
  check(error, 'list');
  return data || [];
}

async function listByStatus(statuses, limit = 500) {
  if (!db()) return mem.jobs.filter((j) => statuses.includes(j.status)).map((j) => ({ ...j }));
  const { data, error } = await db().from('video_jobs').select('*').in('status', statuses).order('created_at', { ascending: true }).limit(limit);
  check(error, 'listByStatus');
  return data || [];
}

// ---------- storage limits (R2 free tier) ----------

const LIVE = ['uploading', 'queued', 'processing', 'awaiting_approval', 'done', 'failed'];
async function bytesUsed(workspaceId = null) {
  const rows = db()
    ? await (async () => {
      let q = db().from('video_jobs').select('workspace_id, original_bytes, output_bytes').in('status', LIVE);
      if (workspaceId) q = q.eq('workspace_id', workspaceId);
      const { data, error } = await q;
      check(error, 'bytesUsed');
      return data || [];
    })()
    : mem.jobs.filter((j) => LIVE.includes(j.status) && (!workspaceId || j.workspace_id === workspaceId));
  const brandBytes = await require('./brandKit').bytesUsed(workspaceId).catch(() => 0);
  return rows.reduce((sum, j) => sum + Number(j.original_bytes || 0) + Number(j.output_bytes || 0), 0) + brandBytes;
}

/** Room for `bytes` more (and the finished videos, roughly the same again)? Returns null or a reason. */
async function storageProblem(workspaceId, bytes) {
  const needed = Number(bytes) * 2;
  const [all, mine] = await Promise.all([bytesUsed(null), bytesUsed(workspaceId)]);
  if (all + needed > STORAGE_LIMIT_BYTES) {
    return `Video storage is nearly full (the free plan's limit). Delete finished videos you've already downloaded, or wait for old ones to be cleared (after ${KEEP_DAYS} days).`;
  }
  if (mine + needed > PER_BUSINESS_LIMIT_BYTES) {
    return `Your business has used its video storage. Delete finished videos you've already downloaded to make room.`;
  }
  return null;
}

// ---------- the business's side ----------

const PLATFORMS = ['instagram', 'tiktok', 'youtube'];
const STYLES = ['captions', 'clean'];

/** The three questions. Returns { answers, errors, fieldErrors }. */
function validateAnswers(body = {}) {
  const fieldErrors = {};
  const platform = String(body.platform || '').toLowerCase();
  const cta = String(body.cta || '').trim();
  const style = String(body.style || '').toLowerCase();
  if (!PLATFORMS.includes(platform)) fieldErrors.platform = 'Choose where the video is going: Instagram, TikTok or YouTube.';
  if (!cta) fieldErrors.cta = 'Say what viewers should do at the end (e.g. "Order on WhatsApp").';
  else if (cta.length > 120) fieldErrors.cta = 'Keep the call to action under 120 characters.';
  if (!STYLES.includes(style)) fieldErrors.style = 'Choose captions and graphics, or a clean cut.';
  const answers = { platform, cta, style, both_formats: body.both_formats === true, language: /^[a-z]{2}$/.test(body.language || '') ? body.language : 'en' };
  return { answers, fieldErrors, errors: Object.values(fieldErrors) };
}

/**
 * mode: 'auto' (the original automatic edit), 'custom' ("edit my video my way":
 * plan -> approve -> render) or 'website' ("make a video of my website": explore
 * + plan -> approve -> render). `request` holds the description, links and
 * choices - never login details (those stay in memory: loginVault.js).
 */
async function create({ workspaceId, userId, kind = 'edit', originalName = null, bytes = 0, contentType = null, answers = {}, mode = 'auto', request = null }) {
  const id = crypto.randomUUID();
  const row = {
    id,
    workspace_id: workspaceId,
    user_id: userId || null,
    kind,
    // Columns from migration 0012 are only sent for the new modes (the automatic edit works without it).
    ...(mode !== 'auto' ? { mode, phase: 'plan', request: request || {} } : {}),
    status: kind === 'test_clip' || mode === 'website' ? 'queued' : 'uploading',
    original_name: originalName,
    original_key: originalName ? storage.keys.original(workspaceId, id, originalName) : null,
    original_bytes: Number(bytes) || 0,
    content_type: contentType,
    answers,
    stage: 'waiting',
    progress: 0,
    stage_log: [],
    output_bytes: 0,
    attempts: 0,
    created_at: now(),
    updated_at: now(),
  };
  return insert(row);
}

/** The browser finished uploading: check the file really is in R2, then queue it. */
async function markUploaded(id, workspaceId) {
  const job = await get(id, workspaceId);
  if (!job) return { error: 'not_found' };
  if (job.status !== 'uploading') return { job };
  const size = await storage.sizeOf(job.original_key);
  if (!size) return { error: 'not_uploaded' };
  return { job: await patch(id, { status: 'queued', original_bytes: size, stage: 'waiting' }, { workspace_id: workspaceId }) };
}

/** Cancel (if running) and delete its files. */
async function remove(id, workspaceId) {
  const job = await get(id, workspaceId);
  if (!job) return false;
  require('./loginVault').drop(id); // a website login still waiting for the worker: forgotten
  if (storage.isConfigured()) await storage.deletePrefix(storage.keys.jobPrefix(workspaceId, id)).catch((err) => console.warn(`[video] files of ${id} not deleted: ${err.message}`));
  await patch(id, { status: job.status === 'processing' || job.status === 'queued' ? 'canceled' : 'expired', output_bytes: 0, original_bytes: 0 }, { workspace_id: workspaceId });
  return true;
}

// ---------- the worker's side ----------

/** Oldest queued job, claimed atomically (two workers can never take the same one). */
async function claimNext(workerId) {
  for (const candidate of await listByStatus(['queued'], 10)) {
    const claimed = await patch(candidate.id, {
      status: 'processing', worker_id: workerId, claimed_at: now(), heartbeat_at: now(), attempts: Number(candidate.attempts || 0) + 1, error: null,
    }, { status: 'queued' });
    if (claimed) return claimed;
  }
  return null;
}

async function progress(id, workerId, { stage, progress: pct, message } = {}) {
  const job = await getForWorker(id, workerId);
  if (!job) return { error: 'not_found' };
  if (job.status !== 'processing') return { canceled: true };
  const fields = { heartbeat_at: now() };
  if (stage && STAGES[stage]) {
    fields.stage = stage;
    if (stage !== job.stage || message) {
      const log = Array.isArray(job.stage_log) ? job.stage_log.slice(-40) : [];
      log.push({ stage, label: STAGES[stage], message: message ? String(message).slice(0, 300) : null, at: now() });
      fields.stage_log = log;
    }
  }
  if (Number.isFinite(Number(pct))) fields.progress = Math.max(0, Math.min(99, Math.round(Number(pct))));
  await patch(id, fields, { worker_id: workerId });
  return { ok: true };
}

async function complete(id, workerId, result) {
  const job = await getForWorker(id, workerId);
  if (!job) return null;
  if (job.status !== 'processing') return { canceled: true };
  const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
  const outputBytes = outputs.reduce((s, o) => s + Number(o.bytes || 0), 0);
  const expires = new Date(Date.now() + KEEP_DAYS * 86400000).toISOString();
  const log = Array.isArray(job.stage_log) ? job.stage_log.slice(-40) : [];
  log.push({ stage: 'done', label: STAGES.done, at: now() });
  return patch(id, {
    status: 'done', stage: 'done', progress: 100, stage_log: log, result, output_bytes: outputBytes, finished_at: now(), expires_at: expires, heartbeat_at: now(),
  }, { worker_id: workerId });
}

async function fail(id, workerId, error) {
  const job = await getForWorker(id, workerId);
  if (!job) return null;
  return patch(id, {
    status: 'failed', error: String(error || 'The video editor hit a problem').slice(0, 1000), finished_at: now(),
    expires_at: new Date(Date.now() + KEEP_DAYS * 86400000).toISOString(),
  }, { worker_id: workerId });
}

/**
 * The worker finished planning: the plan waits for the business's approval.
 * The worker lets go of the job meanwhile (it may be another worker that renders).
 */
async function submitPlan(id, workerId, plan) {
  const job = await getForWorker(id, workerId);
  if (!job) return null;
  if (job.status !== 'processing') return { canceled: true };
  const log = Array.isArray(job.stage_log) ? job.stage_log.slice(-40) : [];
  log.push({ stage: 'awaiting', label: STAGES.awaiting, at: now() });
  return patch(id, { status: 'awaiting_approval', plan, stage: 'awaiting', stage_log: log, worker_id: null, heartbeat_at: null }, { worker_id: workerId });
}

/** "Approve": render it as planned. */
async function approve(id, workspaceId) {
  const job = await get(id, workspaceId);
  if (!job || job.status !== 'awaiting_approval') return null;
  return patch(id, { status: 'queued', phase: 'render', approved_at: now(), stage: 'waiting', progress: 0 }, { workspace_id: workspaceId, status: 'awaiting_approval' });
}

/** "Change it": plan again from a new description (the old plan is dropped). */
async function revise(id, workspaceId, description) {
  const job = await get(id, workspaceId);
  if (!job || !['awaiting_approval', 'failed'].includes(job.status) || job.mode === 'auto') return null;
  return patch(id, {
    status: 'queued', phase: 'plan', plan: null, error: null, stage: 'waiting', progress: 0, attempts: 0,
    request: { ...(job.request || {}), description: description ?? job.request?.description, revision: Number(job.request?.revision || 0) + 1 },
  }, { workspace_id: workspaceId });
}

/** Add the post caption/hashtags to a finished job (they're written after it's done). */
async function setPostText(id, workspaceId, post) {
  const job = await get(id, workspaceId);
  if (!job) return null;
  return patch(id, { result: { ...(job.result || {}), post } }, { workspace_id: workspaceId });
}

// ---------- housekeeping (scheduler) ----------

/** A worker that went quiet mid-job (laptop asleep, crash): requeue once, then fail. */
async function requeueStale() {
  const cutoff = Date.now() - STALE_MINUTES * 60000;
  let n = 0;
  for (const j of await listByStatus(['processing'])) {
    if (new Date(j.heartbeat_at || j.claimed_at || 0).getTime() > cutoff) continue;
    const again = Number(j.attempts || 0) < MAX_ATTEMPTS;
    await patch(j.id, again
      ? { status: 'queued', worker_id: null, stage: 'waiting', progress: 0 }
      : { status: 'failed', error: 'The video editor stopped while working on this (was the computer turned off?). Please try again.', finished_at: now() },
    { status: 'processing' });
    n += 1;
  }
  return n;
}

/** Delete files of jobs past their keep date, and uploads that never finished. */
async function cleanup() {
  if (!storage.isConfigured()) return 0;
  const nowMs = Date.now();
  let n = 0;
  for (const j of await listByStatus(['done', 'failed', 'canceled', 'uploading', 'awaiting_approval'])) {
    const old = j.status === 'uploading'
      ? nowMs - new Date(j.created_at).getTime() > 86400000
      : j.status === 'awaiting_approval'
        ? nowMs - new Date(j.updated_at || j.created_at).getTime() > KEEP_DAYS * 86400000 // a plan nobody approved
      : j.status === 'canceled' || (j.expires_at && new Date(j.expires_at).getTime() < nowMs);
    if (!old) continue;
    await storage.deletePrefix(storage.keys.jobPrefix(j.workspace_id, j.id)).catch((err) => console.warn(`[video] cleanup of ${j.id}: ${err.message}`));
    await patch(j.id, { status: 'expired', original_bytes: 0, output_bytes: 0 });
    n += 1;
  }
  return n;
}

let lastHousekeeping = 0;
async function tick() {
  if (Date.now() - lastHousekeeping < 5 * 60000) return;
  lastHousekeeping = Date.now();
  try {
    const requeued = await requeueStale();
    const cleaned = await cleanup();
    if (requeued || cleaned) console.log(`[video] housekeeping: ${requeued} stalled job(s) handled, ${cleaned} old job(s) cleared`);
  } catch (err) {
    if (err.code !== 'MIGRATION_MISSING') console.warn(`[video] housekeeping failed: ${err.message}`);
  }
}

// ---------- is the worker there? (it checks in every ~15 s) ----------

const workers = new Map(); // workerId -> { lastSeen, info }
const OFFLINE_AFTER_MS = 60 * 1000;

function heartbeat(workerId, info = {}) {
  const id = String(workerId).slice(0, 80);
  const prev = workers.get(id);
  // The worker's public key (website logins are encrypted in the browser with it; only that worker can read them).
  const key = typeof info.publicKey === 'string' && info.publicKey.length < 2000 && /^[A-Za-z0-9+/=]+$/.test(info.publicKey) && /^[\w-]{6,64}$/.test(info.keyId || '')
    ? { keyId: info.keyId, publicKey: info.publicKey } : prev?.key || null;
  workers.set(id, { lastSeen: Date.now(), key, info: { version: info.version || null, busy: !!info.busy, platform: info.platform || null } });
}

function workerStatus() {
  let last = 0;
  let key = null;
  for (const w of workers.values()) {
    if (w.lastSeen > last) { last = w.lastSeen; key = w.key; }
  }
  const online = !!last && Date.now() - last < OFFLINE_AFTER_MS;
  return { online, lastSeen: last ? new Date(last).toISOString() : null, loginKey: online ? key : null };
}

function _reset() { mem.jobs.length = 0; workers.clear(); lastHousekeeping = 0; }

module.exports = {
  STAGES, KEEP_DAYS, STORAGE_LIMIT_BYTES, PER_BUSINESS_LIMIT_BYTES, MAX_UPLOAD_BYTES, PLATFORMS, STYLES,
  validateAnswers, create, get, list, markUploaded, remove, setPostText, submitPlan, approve, revise,
  claimNext, getForWorker, progress, complete, fail,
  bytesUsed, storageProblem, requeueStale, cleanup, tick,
  heartbeat, workerStatus, _reset, _mem: mem,
};
