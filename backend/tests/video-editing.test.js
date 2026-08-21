const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const { WORKSPACE_ROOT } = require('../plugins/filesystem/workspaceSafety');

function ffmpegAvailable() {
  const result = spawnSync('ffmpeg', ['-version']);
  return result.status === 0;
}

function ffprobeDimensions(filePath) {
  return execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`).toString().trim();
}

async function main() {
  if (!ffmpegAvailable()) {
    console.log('⚠ ffmpeg is not installed in this environment - skipping video editing tests (this is an optional local dependency, not a code failure)');
    return;
  }

  loadPlugins();

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-edit-test-'));
  const testVideoPath = path.join(testDir, 'input.mp4');
  execSync(
    `ffmpeg -y -f lavfi -i "testsrc=duration=3:size=1280x720:rate=30" -f lavfi -i "sine=frequency=440:duration=3" -c:v libx264 -c:a aac -shortest "${testVideoPath}"`,
    { stdio: 'pipe' }
  );

  const testSrtPath = path.join(testDir, 'test.srt');
  fs.writeFileSync(testSrtPath, '1\n00:00:00,000 --> 00:00:01,500\nThis is a test caption\n\n2\n00:00:01,500 --> 00:00:03,000\nBurned into the video\n');

  const result1 = await toolRegistry.call('video.edit', { inputPath: testVideoPath, projectId: 'video-edit-test-1', vertical: true }, { role: 'test' });
  assert(fs.existsSync(result1.fullPath), 'the edited output file should genuinely exist');
  assert.strictEqual(ffprobeDimensions(result1.fullPath), '1080,1920', 'output should be genuinely resized to vertical 1080x1920');
  console.log('✓ vertical crop produces a real 1080x1920 output video');

  const result2 = await toolRegistry.call('video.edit', { inputPath: testVideoPath, projectId: 'video-edit-test-2', srtPath: testSrtPath, vertical: true }, { role: 'test' });
  assert.strictEqual(ffprobeDimensions(result2.fullPath), '1080,1920', 'dimensions should stay correct with captions added');
  const noCapSize = fs.statSync(result1.fullPath).size;
  const withCapSize = fs.statSync(result2.fullPath).size;
  assert.notStrictEqual(noCapSize, withCapSize, 'burning in captions should genuinely change the video content, not be a silent no-op');
  console.log('✓ captions are genuinely burned in (real, verifiable content change), dimensions stay correct');

  await assert.rejects(
    toolRegistry.call('video.edit', { inputPath: '/does/not/exist.mp4', projectId: 'video-edit-test-3' }, { role: 'test' }),
    /Input file not found/
  );
  console.log('✓ a missing input file fails clearly before ever calling ffmpeg');

  await assert.rejects(
    toolRegistry.call('video.edit', { inputPath: testVideoPath, projectId: 'video-edit-test-4', srtPath: '/does/not/exist.srt' }, { role: 'test' }),
    /SRT file not found/
  );
  console.log('✓ a missing SRT file fails clearly before ever calling ffmpeg');

  const result5 = await toolRegistry.call('video.edit', { inputPath: testVideoPath, projectId: 'video-edit-test-5', vertical: false }, { role: 'test' });
  assert.strictEqual(ffprobeDimensions(result5.fullPath), '1280,720', 'vertical: false should leave the original dimensions untouched');
  console.log('✓ vertical: false correctly skips the crop/blur step entirely');

  const corruptPath = path.join(testDir, 'corrupt.mp4');
  fs.writeFileSync(corruptPath, 'this is not a real video file at all');
  await assert.rejects(
    toolRegistry.call('video.edit', { inputPath: corruptPath, projectId: 'video-edit-test-6' }, { role: 'test' }),
    /ffmpeg exited with code/
  );
  console.log('✓ a genuinely corrupt input file surfaces a real ffmpeg error, not a crash');

  for (const id of ['video-edit-test-1', 'video-edit-test-2', 'video-edit-test-5']) {
    fs.rmSync(path.join(WORKSPACE_ROOT, id), { recursive: true, force: true });
  }
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\nAll video editing checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
