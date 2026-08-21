const fs = require('fs');
const path = require('path');
const config = require('../../../config');
const { resolveSafePath, ensureProjectDir } = require('../../filesystem/workspaceSafety');

// Deliberately whisper-1, NOT gpt-4o-transcribe/gpt-4o-mini-transcribe -
// those newer, "recommended" models only support response_format=json (no
// timestamps, no SRT at all). whisper-1 is the only model that supports
// verbose_json with per-segment timing, which burning accurate captions
// later genuinely requires. Not a compromise - the correct choice for this
// specific need despite being the "legacy" option.
const MODEL = 'whisper-1';
const MAX_BYTES = 25 * 1024 * 1024; // OpenAI's real, hard limit for this endpoint

function toSrtTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function segmentsToSrt(segments) {
  return segments
    .map((seg, i) => `${i + 1}\n${toSrtTimestamp(seg.start)} --> ${toSrtTimestamp(seg.end)}\n${seg.text.trim()}\n`)
    .join('\n');
}

module.exports = {
  name: 'transcribe',
  permission: 'speech',
  irreversible: false,

  /**
   * @param {string} filePath - absolute path to a video or audio file
   * @param {string} [language] - ISO 639-1 hint (e.g. "en"), optional
   * @param {string} [projectId] - if given, also saves transcript.srt and
   *   transcript.txt into that project's sandboxed workspace, for a later
   *   step (e.g. FFmpeg captioning) to read directly from disk.
   */
  async run({ filePath, language, projectId }) {
    if (!config.llm.openaiKey) {
      throw new Error('Transcription not configured - set OPENAI_API_KEY in .env');
    }
    if (!filePath) throw new Error('transcribe requires "filePath"');
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const stat = fs.statSync(filePath);
    if (stat.size > MAX_BYTES) {
      throw new Error(`File is ${(stat.size / 1024 / 1024).toFixed(1)}MB, which exceeds OpenAI's 25MB limit for transcription`);
    }

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json');
    if (language) form.append('language', language);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.llm.openaiKey}` },
      body: form,
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || `OpenAI transcription API error (HTTP ${res.status})`);
    }

    const segments = json.segments || [];
    const srt = segmentsToSrt(segments);
    const text = json.text || '';

    const result = { text, srt, segments, duration: json.duration || null };

    if (projectId) {
      ensureProjectDir(projectId);
      const srtPath = resolveSafePath(projectId, 'transcript.srt');
      const txtPath = resolveSafePath(projectId, 'transcript.txt');
      fs.mkdirSync(path.dirname(srtPath), { recursive: true });
      fs.writeFileSync(srtPath, srt, 'utf-8');
      fs.writeFileSync(txtPath, text, 'utf-8');
      result.srtPath = srtPath;
      result.txtPath = txtPath;
    }

    return result;
  },
};
