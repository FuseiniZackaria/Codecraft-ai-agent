const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveProjectRoot, resolveSafePath, ensureProjectDir } = require('../../filesystem/workspaceSafety');

function runFfmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { cwd });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('ffmpeg is not installed or not on PATH - install it and restart the backend (see the setup docs)'));
      } else {
        reject(err);
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`)); // stderr can be huge, keep the tail (the actual error is usually at the end)
    });
  });
}

module.exports = {
  name: 'edit',
  permission: 'video',
  irreversible: false,

  /**
   * @param {string} inputPath - absolute path to the source video
   * @param {string} projectId - workspace project to write the result into
   * @param {string} [srtPath] - absolute path to an SRT file to burn in as captions
   * @param {boolean} [vertical=true] - crop/pad to 9:16 vertical with a blurred-background fill (the standard short-form look), rather than a hard crop or plain black bars
   */
  async run({ inputPath, projectId, srtPath, vertical = true }) {
    if (!inputPath) throw new Error('edit requires "inputPath"');
    if (!projectId) throw new Error('edit requires "projectId"');
    if (!fs.existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);
    if (srtPath && !fs.existsSync(srtPath)) throw new Error(`SRT file not found: ${srtPath}`);

    ensureProjectDir(projectId);
    const projectDir = resolveProjectRoot(projectId);
    const outputRelative = 'edited.mp4';
    const outputPath = resolveSafePath(projectId, outputRelative);

    // If burning captions, copy the SRT into the project workspace under a
    // plain relative filename, and run ffmpeg with cwd set there. FFmpeg's
    // subtitles filter has real, well-known trouble parsing absolute
    // Windows paths inside a filter string - the drive letter's colon
    // collides with the filter syntax's own use of colons as separators.
    // A bare relative filename with the right working directory sidesteps
    // this entirely instead of fighting manual escaping.
    const captionStyle = "force_style='FontSize=28,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Alignment=2'";
    let subtitlesClause = null;
    if (srtPath) {
      const localSrt = 'transcript.srt';
      fs.copyFileSync(srtPath, resolveSafePath(projectId, localSrt));
      subtitlesClause = `subtitles=${localSrt}:${captionStyle}`;
    }

    let filterComplex;
    if (vertical) {
      const bg = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20[bg]`;
      const fg = `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg]`;
      const merge = `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
      filterComplex = subtitlesClause ? `${bg};${fg};${merge}[merged];[merged]${subtitlesClause}[out]` : `${bg};${fg};${merge}[out]`;
    } else if (subtitlesClause) {
      filterComplex = `[0:v]${subtitlesClause}[out]`;
    } else {
      filterComplex = null;
    }

    const args = ['-y', '-i', inputPath];
    if (filterComplex) {
      args.push('-filter_complex', filterComplex, '-map', '[out]', '-map', '0:a?');
    }
    args.push('-c:a', 'aac', outputRelative);

    await runFfmpeg(args, projectDir);

    if (!fs.existsSync(outputPath)) {
      throw new Error('ffmpeg reported success but no output file was produced');
    }

    return { path: outputRelative, fullPath: outputPath, bytes: fs.statSync(outputPath).size };
  },
};
