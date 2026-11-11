/**
 * The free voiceover voices (Kokoro, run on the video worker - no paid voice
 * service). Speaker numbers are those of the kokoro-en-v0_19 model.
 * Shared by the backend (checks the choice) and the worker (uses it).
 */
const VOICES = [
  { id: 'am_michael', sid: 6, label: 'Michael - US, male' },
  { id: 'am_adam', sid: 5, label: 'Adam - US, male' },
  { id: 'bm_george', sid: 9, label: 'George - UK, male' },
  { id: 'bm_lewis', sid: 10, label: 'Lewis - UK, male' },
  { id: 'af_bella', sid: 1, label: 'Bella - US, female' },
  { id: 'af_sarah', sid: 3, label: 'Sarah - US, female' },
  { id: 'af_nicole', sid: 2, label: 'Nicole - US, female (soft)' },
  { id: 'af_sky', sid: 4, label: 'Sky - US, female' },
  { id: 'bf_emma', sid: 7, label: 'Emma - UK, female' },
  { id: 'bf_isabella', sid: 8, label: 'Isabella - UK, female' },
];
const DEFAULT_VOICE = 'am_michael';

module.exports = { VOICES, DEFAULT_VOICE };
