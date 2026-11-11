const { spawn } = require('child_process');
const { config, childEnv } = require('./config');

/**
 * Run a program and collect its output. `onProgress(seconds)` follows an
 * FFmpeg run (via -progress). Every running child is tracked so a canceled
 * job can stop them at once.
 */

const running = new Set();

class CanceledError extends Error {
  constructor() { super('Canceled'); this.name = 'CanceledError'; }
}

function run(cmd, args, { cwd, env, timeoutMs = 0, onLine = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env || childEnv(), windowsHide: true });
    running.add(child);
    let stdout = '';
    let stderr = '';
    let killedForTime = false;
    const timer = timeoutMs ? setTimeout(() => { killedForTime = true; child.kill('SIGKILL'); }, timeoutMs) : null;
    const lines = (chunk, sink) => {
      if (!onLine) return;
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) onLine(line, sink);
    };
    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 4e6) stdout = stdout.slice(-2e6); lines(d, 'out'); });
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 4e6) stderr = stderr.slice(-2e6); lines(d, 'err'); });
    child.on('error', (err) => {
      running.delete(child);
      if (timer) clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new Error(`${cmd} was not found - run "npm run setup" in the worker folder`) : err);
    });
    child.on('close', (code, signal) => {
      running.delete(child);
      if (timer) clearTimeout(timer);
      if (child.canceled) return reject(new CanceledError());
      if (killedForTime) return reject(new Error(`${cmd} took too long and was stopped`));
      if (code === 0) return resolve({ stdout, stderr });
      const err = new Error(`${require('path').basename(cmd)} failed (${signal || code}): ${stderr.slice(-1500).trim() || stdout.slice(-800).trim()}`);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
}

/** FFmpeg with progress: onProgress(fraction 0..1) using the expected output length. */
function ffmpeg(args, { cwd, totalSeconds = 0, onProgress = null, timeoutMs = 0 } = {}) {
  const full = ['-hide_banner', '-nostdin', '-y', ...(onProgress ? ['-progress', 'pipe:1', '-nostats'] : []), ...args];
  return run(config.ffmpeg, full, {
    cwd,
    timeoutMs,
    onLine: onProgress && totalSeconds > 0 ? (line, sink) => {
      if (sink !== 'out') return;
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / totalSeconds));
    } : null,
  });
}

function cancelAll() {
  for (const child of running) {
    child.canceled = true;
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

module.exports = { run, ffmpeg, cancelAll, CanceledError };
