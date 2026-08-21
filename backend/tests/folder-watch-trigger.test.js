const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadPlugins } = require('../core/pluginLoader');
const memory = require('../memory');
const mockProvider = require('../core/providers/mockProvider');
const scheduler = require('../core/scheduler');

function stub(responder) {
  const original = mockProvider.complete;
  mockProvider.complete = responder;
  return () => { mockProvider.complete = original; };
}

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'watch-test-'));
}

async function main() {
  loadPlugins();

  let dir = freshDir();
  assert.strictEqual(
    scheduler.checkFolderWatch({ watchFolder: dir, lastRunAt: null, createdAt: new Date(Date.now() - 10000).toISOString() }),
    null,
    'an empty folder should have no candidate'
  );

  const videoPath = path.join(dir, 'clip1.mp4');
  fs.writeFileSync(videoPath, 'fake video data');
  const def = { watchFolder: dir, lastRunAt: null, createdAt: new Date(Date.now() - 10000).toISOString() };
  assert.strictEqual(scheduler.checkFolderWatch(def), videoPath, 'a new video file should be detected');

  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a video');
  assert.strictEqual(scheduler.checkFolderWatch(def), videoPath, 'non-video files must be ignored');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('✓ checkFolderWatch detects new video files and ignores non-video files');

  dir = freshDir();
  const oldVideoPath = path.join(dir, 'old.mp4');
  fs.writeFileSync(oldVideoPath, 'old video');
  const oldTime = new Date(Date.now() - 100000);
  fs.utimesSync(oldVideoPath, oldTime, oldTime);
  const oldDef = { watchFolder: dir, lastRunAt: new Date(Date.now() - 5000).toISOString(), createdAt: new Date(Date.now() - 200000).toISOString() };
  assert.strictEqual(scheduler.checkFolderWatch(oldDef), null, 'a file older than lastRunAt must be ignored');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("✓ checkFolderWatch correctly ignores files older than the workflow's lastRunAt");

  dir = freshDir();
  const older = path.join(dir, 'older.mp4');
  const newer = path.join(dir, 'newer.mp4');
  fs.writeFileSync(older, 'older content');
  fs.writeFileSync(newer, 'newer content');
  const t1 = new Date(Date.now() - 3000);
  const t2 = new Date(Date.now() - 1000);
  fs.utimesSync(older, t1, t1);
  fs.utimesSync(newer, t2, t2);
  const multiDef = { watchFolder: dir, lastRunAt: new Date(Date.now() - 4000).toISOString(), createdAt: new Date(Date.now() - 500000).toISOString() };
  assert.strictEqual(scheduler.checkFolderWatch(multiDef), older, 'the OLDEST new file should be returned, not the newest');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('✓ checkFolderWatch returns the oldest new file first when several are present');

  assert.strictEqual(
    scheduler.checkFolderWatch({ watchFolder: '/this/does/not/exist', lastRunAt: null, createdAt: new Date().toISOString() }),
    null,
    'a nonexistent folder should return null, not throw'
  );
  console.log('✓ checkFolderWatch handles a nonexistent folder gracefully');

  let restore = stub(async ({ prompt }) => ({ text: `Transcript of: ${prompt}`, provider: 'mock', costEstimate: 0 }));
  dir = freshDir();
  const graph = {
    nodes: [
      { id: 'trigger_1', type: 'trigger', config: {} },
      { id: 'process_video', type: 'agent', config: { agentKey: 'ceo', goal: 'Process this new video file: {{trigger.output}}' } },
    ],
    edges: [{ id: 'e1', source: 'trigger_1', target: 'process_video' }],
  };
  await memory.saveWorkflowDefinition({
    id: 'wf-folder-watch-test',
    name: 'Folder watch test',
    graph,
    enabled: true,
    scheduleType: 'folder_watch',
    watchFolder: dir,
    lastRunAt: null,
    createdAt: new Date(Date.now() - 10000).toISOString(),
  });
  const testVideoPath = path.join(dir, 'my-video.mp4');
  fs.writeFileSync(testVideoPath, 'fake video bytes');

  await scheduler.tick();
  await new Promise((r) => setTimeout(r, 200));

  const definition = await memory.getWorkflowDefinition('wf-folder-watch-test');
  assert(definition.lastRunAt, 'lastRunAt should be updated after the workflow fires');

  const runs = await memory.listWorkflowRuns('wf-folder-watch-test');
  assert.strictEqual(runs.length, 1, 'exactly one run should have been created');
  assert.strictEqual(runs[0].status, 'done');
  assert(runs[0].context.process_video.output.includes(testVideoPath), 'the detected file path must reach the downstream node via {{trigger.output}}');
  console.log('✓ a real folder-watch workflow fires through tick(), correctly threading the detected file path to downstream nodes');

  await scheduler.tick();
  await new Promise((r) => setTimeout(r, 200));
  const runsAfter = await memory.listWorkflowRuns('wf-folder-watch-test');
  assert.strictEqual(runsAfter.length, 1, 'the same file must not be reprocessed on a subsequent tick');
  console.log('✓ a subsequent tick does not reprocess the same file');
  fs.rmSync(dir, { recursive: true, force: true });
  restore();

  restore = stub(async () => ({ text: 'Generated content', provider: 'mock', costEstimate: 0 }));
  const scheduledGraph = {
    nodes: [
      { id: 'trigger_1', type: 'trigger', config: {} },
      { id: 'do_something', type: 'agent', config: { agentKey: 'ceo', goal: 'Do a scheduled thing' } },
    ],
    edges: [{ id: 'e1', source: 'trigger_1', target: 'do_something' }],
  };
  await memory.saveWorkflowDefinition({
    id: 'wf-interval-test',
    name: 'Interval test',
    graph: scheduledGraph,
    enabled: true,
    scheduleType: 'interval',
    intervalMinutes: 5,
    lastRunAt: null,
    createdAt: new Date(Date.now() - 10000).toISOString(),
  });
  await scheduler.tick();
  await new Promise((r) => setTimeout(r, 200));
  const scheduledRuns = await memory.listWorkflowRuns('wf-interval-test');
  assert.strictEqual(scheduledRuns.length, 1, 'a schedule-based graph workflow should now fire automatically');
  assert.strictEqual(scheduledRuns[0].status, 'done');
  restore();
  console.log('✓ schedule-based graph workflows now fire automatically (previously never worked at all)');

  console.log('\nAll folder-watch trigger checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
