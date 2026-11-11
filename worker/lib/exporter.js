const { config } = require('./config');
const { ffmpeg } = require('./run');
const { fitFilter } = require('./framing');

/**
 * The one quality-losing step, done once and at top quality:
 * H.264 High profile, CRF 16 (visually lossless), slow preset, the source's
 * own frame rate, BT.709 colour tags, AAC 320 kbps at 48 kHz, fast-start for
 * instant playback online. Never lowered to save time.
 *
 * Also: fit into 9:16 or 16:9 (blurred background when the shapes differ),
 * lay the transparent captions/graphics overlay on top, and normalise the
 * loudness to -14 LUFS (what Instagram, TikTok and YouTube play at), using
 * the measured values so the levelled voices keep their balance.
 */
async function exportVideo({ master, overlay = null, info, width, height, loudness = null, out, maxSeconds = null, totalSeconds, onProgress }) {
  const args = ['-i', master];
  if (overlay) args.push('-c:v', 'libvpx-vp9', '-i', overlay); // keeps the overlay's transparency
  const video = [fitFilter({ input: '[0:v]', output: overlay ? '[framed]' : '[fitted]', inW: info.width, inH: info.height, outW: width, outH: height })];
  if (overlay) video.push(`[framed][1:v]overlay=0:0:format=auto:shortest=0,format=yuv420p[vout]`);
  else video.push('[fitted]format=yuv420p[vout]');
  const audio = loudness
    ? `[0:a]loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true,aresample=48000[aout]`
    : '[0:a]aresample=48000[aout]';
  args.push('-filter_complex', `${video.join(';')};${audio}`, '-map', '[vout]', '-map', '[aout]');
  if (maxSeconds) args.push('-t', String(maxSeconds));
  args.push(
    '-c:v', 'libx264', '-preset', config.preset, '-crf', String(config.crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', String(info.fps),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', config.audioBitrate, '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    out,
  );
  await ffmpeg(args, { totalSeconds: maxSeconds ? Math.min(maxSeconds, totalSeconds) : totalSeconds, onProgress, timeoutMs: 24 * 3600000 });
  return out;
}

module.exports = { exportVideo };
