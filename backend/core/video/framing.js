/**
 * Fitting a video into a frame (9:16 vertical, 16:9 landscape) - shared by
 * the video.edit plugin and the Content Studio video worker (worker/).
 *
 * Same look as before: when the shapes differ, the video sits whole in the
 * middle over a blurred, zoomed copy of itself (the standard short-form
 * look) - never a hard crop of the speaker or plain black bars.
 *
 * Plain functions with no requires, so the worker can load this file alone.
 */

/** Filter text that takes `input` (e.g. "[0:v]") to `output` (e.g. "[framed]") at outW x outH. */
function fitFilter({ input = '[0:v]', output = '[framed]', inW = null, inH = null, outW, outH }) {
  const sameShape = inW && inH && Math.abs(inW / inH - outW / outH) < 0.02;
  if (sameShape) {
    return `${input}scale=${outW}:${outH}:flags=lanczos,setsar=1${output}`;
  }
  const blur = Math.max(10, Math.round(20 * (Math.min(outW, outH) / 1080)));
  return [
    `${input}split=2[fit_a][fit_b]`,
    `[fit_a]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},gblur=sigma=${blur}[fit_bg]`,
    `[fit_b]scale=${outW}:${outH}:force_original_aspect_ratio=decrease:flags=lanczos[fit_fg]`,
    `[fit_bg][fit_fg]overlay=(W-w)/2:(H-h)/2,setsar=1${output}`,
  ].join(';');
}

/**
 * The frame size for a platform: 1080-class or 4K-class, whichever keeps
 * the video's own picture closest to its real detail (least shrinking or
 * stretching), capped at 4K. So a 1080p landscape video going vertical gets
 * a 4K frame (its picture would otherwise be shrunk to 1080 wide), a phone's
 * 1080x1920 stays 1080x1920, 4K stays 4K, and 720p goes up to 1080p.
 */
function outputSize({ inW, inH, aspect }) {
  const vertical = aspect === '9x16';
  const [w1, h1] = vertical ? [1080, 1920] : [1920, 1080];
  const [w4, h4] = vertical ? [2160, 3840] : [3840, 2160];
  const s1 = Math.min(w1 / inW, h1 / inH); // how the picture is scaled to fit each frame
  const s4 = Math.min(w4 / inW, h4 / inH);
  return Math.abs(Math.log(s4)) < Math.abs(Math.log(s1)) - 1e-9 ? { width: w4, height: h4 } : { width: w1, height: h1 };
}

module.exports = { fitFilter, outputSize };
