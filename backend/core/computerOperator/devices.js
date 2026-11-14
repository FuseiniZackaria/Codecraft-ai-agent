/**
 * devices.js - connected computers (one per person) and the queue of
 * actions sent to them (migration 0014).
 *
 *   A person opens "My computer", gets a one-time connect code, and runs the
 *   Computer Helper on their PC with it. The helper swaps the code for a
 *   secret (we keep only its sha256) and then asks for work every few
 *   seconds. Each action is a computer_jobs row: the queue AND the person's
 *   activity log. File lists that come back are deleted from the row as
 *   soon as the agent has read them; only a one-line summary stays.
 *
 * One active computer per person: connecting a new one disconnects the old.
 * Supabase when configured, memory otherwise (tests, local without DB).
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const config = require('../../config');

const CODE_TTL_MS = 10 * 60 * 1000;
const ONLINE_MS = 90 * 1000; // the helper checks in at least every ~30 s
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const events = new EventEmitter();
events.setMaxListeners(0);

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase?.url && config.supabase?.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}
const mem = { devices: new Map(), jobs: new Map() };

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => new Date().toISOString();

function missingTable(error) {
  return /does not exist|schema cache/i.test(error?.message || '');
}
function fail(error) {
  if (missingTable(error)) {
    throw new Error('The computer tables are missing - run backend/database/migrations/0014_computer_helper.sql in Supabase first.');
  }
  throw new Error(error.message || String(error));
}

function newCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
const normCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const isOnline = (d) => !!d?.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < ONLINE_MS;

/** What the page may see about a computer - never hashes. */
function publicDevice(d) {
  if (!d) return null;
  return {
    id: d.id,
    user_id: d.user_id,
    name: d.name || 'My computer',
    status: d.status,
    paused: !!d.paused,
    online: d.status === 'active' && isOnline(d),
    roots: Array.isArray(d.roots) ? d.roots : [],
    apps: Array.isArray(d.apps) ? d.apps : [],
    last_seen_at: d.last_seen_at || null,
    created_at: d.created_at,
    pair_expires_at: d.status === 'pending' ? d.pair_expires_at : null,
  };
}

// ---------- low-level row access ----------

async function getDevice(id) {
  const sb = db();
  if (!sb) return mem.devices.get(id) || null;
  const { data, error } = await sb.from('computer_devices').select('*').eq('id', id).maybeSingle();
  if (error) fail(error);
  return data;
}

async function updateDevice(id, patch) {
  const sb = db();
  if (!sb) {
    const d = mem.devices.get(id);
    if (d) Object.assign(d, patch);
    return d || null;
  }
  const { data, error } = await sb.from('computer_devices').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) fail(error);
  return data;
}

async function devicesOfUser(userId) {
  const sb = db();
  if (!sb) return [...mem.devices.values()].filter((d) => d.user_id === userId);
  const { data, error } = await sb.from('computer_devices').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) fail(error);
  return data || [];
}

// ---------- connecting ----------

/** A one-time code (10 minutes) for this person to connect a computer. */
async function createPairing({ userId, workspaceId = null }) {
  if (!userId) throw new Error('Sign in first.');
  // Unused codes from before are cancelled: only the newest one works.
  for (const d of await devicesOfUser(userId)) {
    if (d.status === 'pending') await updateDevice(d.id, { status: 'revoked', revoked_at: now(), pair_code_hash: null });
  }
  const code = newCode();
  const row = {
    id: crypto.randomUUID(),
    user_id: userId,
    workspace_id: workspaceId,
    status: 'pending',
    pair_code_hash: sha(normCode(code)),
    pair_expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    roots: [],
    apps: [],
    paused: false,
    created_at: now(),
  };
  const sb = db();
  if (!sb) mem.devices.set(row.id, row);
  else {
    const { error } = await sb.from('computer_devices').insert(row);
    if (error) fail(error);
  }
  return { deviceId: row.id, code, expiresAt: row.pair_expires_at };
}

/** The helper swaps a valid code for its secret. Returns null for a wrong or expired code. */
async function redeemPairing({ code, name, roots, apps }) {
  const hash = sha(normCode(code));
  let device;
  const sb = db();
  if (!sb) device = [...mem.devices.values()].find((d) => d.status === 'pending' && d.pair_code_hash === hash) || null;
  else {
    const { data, error } = await sb.from('computer_devices').select('*').eq('status', 'pending').eq('pair_code_hash', hash).maybeSingle();
    if (error) fail(error);
    device = data;
  }
  if (!device || new Date(device.pair_expires_at).getTime() < Date.now()) return null;

  // One computer per person: the old one stops working.
  for (const d of await devicesOfUser(device.user_id)) {
    if (d.id !== device.id && d.status === 'active') await updateDevice(d.id, { status: 'revoked', revoked_at: now() });
  }
  const token = crypto.randomBytes(32).toString('hex');
  await updateDevice(device.id, {
    status: 'active',
    pair_code_hash: null,
    pair_expires_at: null,
    token_hash: sha(token),
    name: cleanName(name),
    roots: cleanList(roots),
    apps: cleanList(apps),
    last_seen_at: now(),
  });
  return { deviceId: device.id, token };
}

const cleanName = (n) => String(n || 'My computer').replace(/[\r\n\t]/g, ' ').trim().slice(0, 80) || 'My computer';
const cleanList = (l) => (Array.isArray(l) ? l : []).map((x) => String(x).slice(0, 400)).filter(Boolean).slice(0, 50);

/** The active computer a helper secret belongs to, or null. */
async function deviceByToken(token) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;
  const hash = sha(token);
  const sb = db();
  let d;
  if (!sb) d = [...mem.devices.values()].find((x) => x.token_hash === hash) || null;
  else {
    const { data, error } = await sb.from('computer_devices').select('*').eq('token_hash', hash).maybeSingle();
    if (error) fail(error);
    d = data;
  }
  return d && d.status === 'active' ? d : null;
}

/** The helper checked in: remember when, and what it shares (for the page). */
async function heartbeat(device, { name, roots, apps } = {}) {
  const patch = { last_seen_at: now() };
  if (name !== undefined) patch.name = cleanName(name);
  if (roots !== undefined) patch.roots = cleanList(roots);
  if (apps !== undefined) patch.apps = cleanList(apps);
  return updateDevice(device.id, patch);
}

async function activeForUser(userId) {
  if (!userId) return null;
  return (await devicesOfUser(userId)).find((d) => d.status === 'active') || null;
}

async function listForUser(userId) {
  return (await devicesOfUser(userId))
    .filter((d) => d.status === 'active' || (d.status === 'pending' && new Date(d.pair_expires_at).getTime() > Date.now()))
    .map(publicDevice);
}

/** Only the computer's own person may pause or disconnect it. */
async function ownDevice(userId, deviceId) {
  const d = await getDevice(deviceId);
  return d && d.user_id === userId && d.status !== 'revoked' ? d : null;
}

async function setPaused(userId, deviceId, paused) {
  const d = await ownDevice(userId, deviceId);
  if (!d) return null;
  return publicDevice(await updateDevice(d.id, { paused: !!paused }));
}

async function revoke(userId, deviceId) {
  const d = await ownDevice(userId, deviceId);
  if (!d) return false;
  await updateDevice(d.id, { status: 'revoked', revoked_at: now(), token_hash: null, pair_code_hash: null });
  // Anything still waiting for this computer is cancelled.
  for (const j of await jobsOfDevice(d.id, ['queued', 'running'])) await finishJob(d.id, j.id, { ok: false, error: 'The computer was disconnected.' }, { force: true });
  return true;
}

// ---------- jobs ----------

async function jobsOfDevice(deviceId, statuses) {
  const sb = db();
  if (!sb) return [...mem.jobs.values()].filter((j) => j.device_id === deviceId && statuses.includes(j.status)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const { data, error } = await sb.from('computer_jobs').select('*').eq('device_id', deviceId).in('status', statuses).order('created_at', { ascending: true }).limit(20);
  if (error) fail(error);
  return data || [];
}

async function getJob(id) {
  const sb = db();
  if (!sb) return mem.jobs.get(id) || null;
  const { data, error } = await sb.from('computer_jobs').select('*').eq('id', id).maybeSingle();
  if (error) fail(error);
  return data;
}

async function updateJob(id, patch, onlyIfStatus) {
  const sb = db();
  if (!sb) {
    const j = mem.jobs.get(id);
    if (!j || (onlyIfStatus && !onlyIfStatus.includes(j.status))) return null;
    Object.assign(j, patch);
    return j;
  }
  let q = sb.from('computer_jobs').update(patch).eq('id', id);
  if (onlyIfStatus) q = q.in('status', onlyIfStatus);
  const { data, error } = await q.select('*').maybeSingle();
  if (error) fail(error);
  return data;
}

async function enqueue({ device, op, args, summary }) {
  const job = {
    id: crypto.randomUUID(),
    device_id: device.id,
    user_id: device.user_id,
    op,
    args: args || {},
    summary: String(summary || op).slice(0, 300),
    status: 'queued',
    created_at: now(),
  };
  const sb = db();
  if (!sb) mem.jobs.set(job.id, job);
  else {
    const { error } = await sb.from('computer_jobs').insert(job);
    if (error) fail(error);
  }
  events.emit(`job:${device.id}`);
  return job;
}

/** The oldest waiting job for this computer, marked running - or null. */
async function claimNext(deviceId) {
  for (const j of await jobsOfDevice(deviceId, ['queued'])) {
    const claimed = await updateJob(j.id, { status: 'running', claimed_at: now() }, ['queued']);
    if (claimed) return claimed;
  }
  return null;
}

/** Wait (up to ms) until a job is queued for this computer. */
function waitForWork(deviceId, ms) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); events.off(`job:${deviceId}`, done); resolve(); };
    const t = setTimeout(done, ms);
    events.on(`job:${deviceId}`, done);
  });
}

const MAX_RESULT_CHARS = 2_000_000;

async function finishJob(deviceId, jobId, { ok, result, error }, { force = false } = {}) {
  const job = await getJob(jobId);
  if (!job || job.device_id !== deviceId) return null;
  let safeResult = ok ? result ?? null : null;
  if (safeResult !== null && JSON.stringify(safeResult).length > MAX_RESULT_CHARS) {
    safeResult = null;
    ok = false;
    error = 'The result was too large to send back.';
  }
  const updated = await updateJob(
    jobId,
    { status: ok ? 'done' : 'failed', result: safeResult, error: ok ? null : String(error || 'Failed').slice(0, 500), finished_at: now() },
    force ? ['queued', 'running'] : ['running'],
  );
  if (updated) events.emit(`done:${jobId}`);
  return updated;
}

/**
 * Wait for a job's outcome. Resolves { ok, result, error }. On timeout the job
 * is marked expired so a late helper can't run it after the user gave up.
 * The file list in the result is wiped from the row once read.
 */
async function waitForResult(jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getJob(jobId);
    if (job && (job.status === 'done' || job.status === 'failed')) {
      const { status, result, error } = job; // copy first: the wipe below may change this same object
      if (result !== null && result !== undefined) await updateJob(jobId, { result: null });
      return status === 'done' ? { ok: true, result } : { ok: false, error };
    }
    await new Promise((resolve) => {
      const done = () => { clearTimeout(t); events.off(`done:${jobId}`, done); resolve(); };
      const t = setTimeout(done, Math.min(2000, Math.max(0, deadline - Date.now())));
      events.on(`done:${jobId}`, done);
    });
  }
  // A late answer is then refused (finishJob only accepts "running"), so no
  // file list is ever stored for a request nobody is waiting on.
  const expired = await updateJob(jobId, { status: 'expired', error: 'No answer from the computer in time.', finished_at: now() }, ['queued', 'running']);
  return { ok: false, error: expired?.claimed_at ? 'started_no_answer' : 'not_picked_up' };
}

/** This person's recent actions on their computer (no file lists). */
async function recentJobs(userId, limit = 30) {
  const sb = db();
  const pick = (j) => ({ id: j.id, op: j.op, summary: j.summary, status: j.status, error: j.error || null, created_at: j.created_at, finished_at: j.finished_at || null });
  if (!sb) {
    return [...mem.jobs.values()].filter((j) => j.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map(pick);
  }
  const { data, error } = await sb.from('computer_jobs').select('id, op, summary, status, error, created_at, finished_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  if (error) fail(error);
  return (data || []).map(pick);
}

const _test = { reset: () => { mem.devices.clear(); mem.jobs.clear(); }, mem, setLastSeen: (id, iso) => { const d = mem.devices.get(id); if (d) d.last_seen_at = iso; } };

module.exports = {
  createPairing, redeemPairing, deviceByToken, heartbeat, activeForUser, listForUser,
  getDevice, setPaused, revoke, enqueue, claimNext, waitForWork, finishJob, waitForResult,
  recentJobs, isOnline, publicDevice, ONLINE_MS, _test,
};
