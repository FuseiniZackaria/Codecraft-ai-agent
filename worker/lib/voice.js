const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');

/**
 * Free voiceover, made on this machine: the Kokoro voice model (Apache 2.0)
 * run by sherpa-onnx in Node - no Python, no paid voice service, nothing sent
 * anywhere. `npm run setup` downloads the model (~320 MB) once.
 */

const MODEL_DIR = process.env.KOKORO_MODEL_DIR || path.join(ROOT, '.tools', 'tts', 'kokoro-en-v0_19');
let tts = null;

function ready() {
  return ['model.onnx', 'voices.bin', 'tokens.txt'].every((f) => fs.existsSync(path.join(MODEL_DIR, f)));
}

function engine() {
  if (tts) return tts;
  if (!ready()) throw new Error('The free voice model is not installed - run "npm run setup" in the worker folder.');
  const sherpa = require('sherpa-onnx-node');
  tts = new sherpa.OfflineTts({
    model: {
      kokoro: {
        model: path.join(MODEL_DIR, 'model.onnx'),
        voices: path.join(MODEL_DIR, 'voices.bin'),
        tokens: path.join(MODEL_DIR, 'tokens.txt'),
        dataDir: path.join(MODEL_DIR, 'espeak-ng-data'),
      },
      numThreads: Math.max(1, Math.min(4, require('os').cpus().length - 1)),
      provider: 'cpu',
      debug: 0,
    },
    maxNumSentences: 1,
  });
  return tts;
}

/**
 * Speak `text` with voice `voiceId` into a WAV file.
 * @returns {{ file, seconds }}
 */
function speak(text, voiceId, out, { speed = 1.0 } = {}) {
  const { VOICES, DEFAULT_VOICE } = require('../../backend/core/video/voices');
  const v = VOICES.find((x) => x.id === voiceId) || VOICES.find((x) => x.id === DEFAULT_VOICE);
  const sherpa = require('sherpa-onnx-node');
  const audio = engine().generate({ text: String(text).replace(/\s+/g, ' ').trim(), sid: v.sid, speed });
  sherpa.writeWave(out, { samples: audio.samples, sampleRate: audio.sampleRate });
  return { file: out, seconds: audio.samples.length / audio.sampleRate };
}

/**
 * Word timings for captions, spread over the spoken length by word length
 * (Kokoro speaks at an even pace; punctuation adds a small pause).
 */
function wordTimes(text, startAt, seconds) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const weight = (w) => Math.max(2, w.replace(/[^\w']/g, '').length) + (/[.!?]$/.test(w) ? 4 : /[,;:]$/.test(w) ? 2 : 0);
  const total = words.reduce((s, w) => s + weight(w), 0) || 1;
  let t = startAt + 0.05;
  const usable = Math.max(0.2, seconds - 0.1);
  return words.map((w) => {
    const d = (weight(w) / total) * usable;
    const item = { text: w, start: +t.toFixed(3), end: +(t + d * 0.92).toFixed(3) };
    t += d;
    return item;
  });
}

module.exports = { speak, wordTimes, ready, MODEL_DIR };
