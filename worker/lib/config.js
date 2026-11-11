const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

/**
 * Worker settings (worker/.env on the laptop, environment variables on Render).
 * The worker only needs the backend's address and its token - no database,
 * storage or AI keys ever live here.
 */

const ROOT = path.join(__dirname, '..');

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
}
function ffprobePath() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  try { return require('ffprobe-static').path; } catch { return 'ffprobe'; }
}

/** whisper-cli for HyperFrames' free local transcription (Windows: downloaded by `npm run setup`). */
function whisperPath() {
  if (process.env.HYPERFRAMES_WHISPER_PATH) return process.env.HYPERFRAMES_WHISPER_PATH;
  const exe = path.join(ROOT, '.tools', 'whisper', 'Release', 'whisper-cli.exe');
  return fs.existsSync(exe) ? exe : null;
}

const config = {
  backendUrl: String(process.env.BACKEND_URL || '').replace(/\/$/, ''),
  token: process.env.VIDEO_WORKER_TOKEN || '',
  workerId: (process.env.WORKER_ID || `${os.hostname()}`).replace(/[^\w.-]/g, '').slice(0, 60) || 'worker',
  workDir: process.env.WORK_DIR || path.join(os.tmpdir(), 'codecraft-video-worker'),
  keepTemp: process.env.KEEP_TEMP === 'true',
  pollMs: Math.max(3000, Number(process.env.POLL_MS) || 10000),
  heartbeatMs: 15000,
  // Quality (never lowered to save time): H.264 High, CRF 16, slow preset; AAC 320 kbps.
  crf: Math.min(23, Math.max(0, Number(process.env.VIDEO_CRF) || 16)),
  preset: process.env.VIDEO_PRESET || 'slow',
  audioBitrate: process.env.AUDIO_BITRATE || '320k',
  whisperModel: process.env.WHISPER_MODEL || 'small.en',
  ffmpeg: ffmpegPath(),
  ffprobe: ffprobePath(),
  whisper: whisperPath(),
  hyperframesBin: path.join(ROOT, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'),
  version: require('../package.json').version,
};

/** Environment for child processes: FFmpeg on PATH (HyperFrames needs it), telemetry off. */
function childEnv(extra = {}) {
  const dirs = [config.ffmpeg, config.ffprobe].filter((p) => p && p.includes(path.sep)).map((p) => path.dirname(p));
  return {
    ...process.env,
    PATH: [...new Set(dirs), process.env.PATH || ''].join(path.delimiter),
    HYPERFRAMES_NO_TELEMETRY: '1', // nothing about clients' videos is reported anywhere
    ...(config.whisper ? { HYPERFRAMES_WHISPER_PATH: config.whisper } : {}),
    ...extra,
  };
}

function problems() {
  const out = [];
  if (!config.backendUrl) out.push('BACKEND_URL is not set (your Render backend address, e.g. https://codecraft-backend.onrender.com).');
  if (!config.token || config.token.length < 24) out.push('VIDEO_WORKER_TOKEN is not set (the same long random value as on Render).');
  return out;
}

module.exports = { config, childEnv, problems, ROOT };
