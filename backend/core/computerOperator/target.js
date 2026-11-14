/**
 * target.js - WHICH computer an action runs on.
 *
 * Rule (owner's decision): each person's requests reach ONLY their own
 * computer. Nobody can reach anyone else's.
 *
 *   1. The person asking has a connected Computer Helper  -> their PC.
 *   2. Otherwise, the old "local" mode: the backend itself runs on the owner's
 *      PC with COMPUTER_ALLOWED_ROOTS set. Only for the owner (or work with no
 *      person, e.g. Telegram on a local setup) - never for other admins, so
 *      they can't reach the owner's files.
 *   3. Otherwise: a clear "connect your computer first" message.
 *
 * An approved delete carries the computer it was planned for (deviceId +
 * forUserId) and only ever runs there - never falls back to local.
 */

const ctx = require('../usage/context');
const devices = require('./devices');
const { runOp } = require('./ops');
const config = require('../../config');

const CONNECT_HINT = 'Connect your computer first: open Toolbox > My computer in the app and follow the steps.';

// How long to wait for the computer's answer.
const TIMEOUT_MS = { findDuplicateFiles: 150_000, findLargeFiles: 90_000, findOldFiles: 90_000, deleteToRecycleBin: 120_000, default: 45_000 };

class ComputerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.code = 'COMPUTER_UNAVAILABLE';
  }
}

function serverRootsConfigured() {
  return (config.computerOperator?.allowedRoots || []).length > 0;
}

function isOwner(c) {
  if (c.role === 'owner') return true;
  const ownerEmail = String(process.env.APP_OWNER_EMAIL || config.applicant?.email || '').trim().toLowerCase();
  return !!ownerEmail && String(c.email || '').toLowerCase() === ownerEmail;
}

/** { kind: 'device', device } | { kind: 'local' } | { kind: 'none', reason } */
async function resolveTarget() {
  const c = ctx.current();
  if (c.userId) {
    let device = null;
    try {
      device = await devices.activeForUser(c.userId);
    } catch (err) {
      // Tables not created yet: the owner's local mode still works.
      if (!(isOwner(c) && serverRootsConfigured())) return { kind: 'none', reason: err.message };
    }
    if (device) return { kind: 'device', device };
    if (isOwner(c) && serverRootsConfigured()) return { kind: 'local' };
    return { kind: 'none', reason: CONNECT_HINT };
  }
  if (serverRootsConfigured()) return { kind: 'local' };
  return {
    kind: 'none',
    reason:
      'No folders are configured for computer access yet. Computer actions run on the computer of the person asking, ' +
      'so ask from the app chat after connecting your computer (Toolbox > My computer) - or, when the backend runs on ' +
      'your own PC, set COMPUTER_ALLOWED_ROOTS.',
  };
}

function summarize(op, a = {}) {
  switch (op) {
    case 'searchFiles': return `Searched for "${a.query}"`;
    case 'findDirectoriesByName': return `Looked for a folder named "${a.name}"`;
    case 'listDirectory': return `Listed ${a.dirPath}`;
    case 'openFile': return `Opened ${a.filePath}`;
    case 'openFolder': return `Opened folder ${a.dirPath}`;
    case 'findLargeFiles': return a.minSizeMB ? `Looked for files over ${a.minSizeMB} MB` : 'Looked for the largest files';
    case 'findOldFiles': return a.minAgeDays ? `Looked for files not changed in ${a.minAgeDays} days` : 'Looked for the oldest files';
    case 'findDuplicateFiles': return 'Looked for duplicate files';
    case 'findAppsByName': return `Looked up the app "${a.name}"`;
    case 'launchApp': return `Started ${a.exePath}`;
    case 'deleteToRecycleBin': return `Moved to Recycle Bin (approved): ${(a.paths || []).join(', ')}`;
    case 'status': return 'Checked what is shared';
    default: return op;
  }
}

async function runOnDevice(device, op, args) {
  if (device.paused) throw new ComputerUnavailableError('Computer access is paused on the "My computer" page - resume it there first.');
  if (!devices.isOnline(device)) {
    throw new ComputerUnavailableError('Your computer is not connected right now - start the Computer Helper on your PC (the "My computer" page shows how), then ask again.');
  }
  const job = await devices.enqueue({ device, op, args, summary: summarize(op, args) });
  const out = await devices.waitForResult(job.id, TIMEOUT_MS[op] || TIMEOUT_MS.default);
  if (out.ok) return out.result;
  if (out.error === 'not_picked_up') throw new ComputerUnavailableError('Your computer did not pick up the request - check the Computer Helper window on your PC is still open.');
  if (out.error === 'started_no_answer') {
    throw new ComputerUnavailableError(
      op === 'deleteToRecycleBin'
        ? 'Your computer started this but did not answer in time - check your Recycle Bin to see what was moved.'
        : 'Your computer took too long to answer - try a narrower request.',
    );
  }
  throw new Error(out.error || 'The computer could not do that.');
}

/**
 * Run a computer action for the person asking.
 * `opts.deviceId` + `opts.forUserId`: an approved action pinned to the computer
 * it was planned for.
 */
async function call(op, args = {}, opts = {}) {
  if (opts.deviceId) {
    const c = ctx.current();
    if (opts.forUserId && c.userId && c.userId !== opts.forUserId) {
      throw new ComputerUnavailableError('Only the person whose computer this is can approve this.');
    }
    const device = await devices.getDevice(opts.deviceId);
    if (!device || device.status !== 'active' || (opts.forUserId && device.user_id !== opts.forUserId)) {
      throw new ComputerUnavailableError('That computer is no longer connected, so nothing was changed.');
    }
    return runOnDevice(device, op, args);
  }
  const t = await resolveTarget();
  if (t.kind === 'device') return runOnDevice(t.device, op, args);
  if (t.kind === 'local') return runOp(op, args);
  throw new ComputerUnavailableError(t.reason);
}

module.exports = { call, resolveTarget, summarize, ComputerUnavailableError, CONNECT_HINT };
