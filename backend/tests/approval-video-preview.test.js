const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const memory = require('../memory');
const mockProvider = require('../core/providers/mockProvider');
const workflowEngine = require('../core/workflowEngine');

function stub(responder) {
  const original = mockProvider.complete;
  mockProvider.complete = responder;
  return () => { mockProvider.complete = original; };
}

async function main() {
  loadPlugins();
  const restore = stub(async () => ({ text: 'Some result', provider: 'mock', costEstimate: 0 }));

  const baseGraph = {
    nodes: [
      { id: 'trigger_1', type: 'trigger', config: {} },
      { id: 'edit_1', type: 'agent', config: { agentKey: 'ceo', goal: 'pretend this is video editing' } },
      {
        id: 'approval_1',
        type: 'approval',
        config: {
          label: 'Review the edited video',
          previewType: 'video',
          previewUrl: 'http://localhost:4000/api/workspace/video-pipeline/file/edited.mp4',
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger_1', target: 'edit_1' },
      { id: 'e2', source: 'edit_1', target: 'approval_1' },
    ],
  };

  await memory.saveWorkflowDefinition({ id: 'wf-video-preview-test', name: 'Video preview test', graph: baseGraph, enabled: true });
  const run = await workflowEngine.runWorkflow('wf-video-preview-test');
  assert.strictEqual(run.status, 'paused_for_approval');
  const task = await memory.getTask(run.pausedTaskId);
  assert.strictEqual(task.payload.previewType, 'video');
  assert.strictEqual(task.payload.preview, 'http://localhost:4000/api/workspace/video-pipeline/file/edited.mp4');
  assert.notStrictEqual(task.payload.preview, 'Some result', 'the preview must be the explicit video URL, not the raw prior-node text output');
  console.log('✓ an approval node with an explicit previewUrl surfaces that URL, not the raw prior output');

  const textGraph = JSON.parse(JSON.stringify(baseGraph));
  delete textGraph.nodes[2].config.previewUrl;
  delete textGraph.nodes[2].config.previewType;
  await memory.saveWorkflowDefinition({ id: 'wf-text-preview-test', name: 'Text preview test', graph: textGraph, enabled: true });
  const run2 = await workflowEngine.runWorkflow('wf-text-preview-test');
  const task2 = await memory.getTask(run2.pausedTaskId);
  assert.strictEqual(task2.payload.previewType, 'text');
  assert.strictEqual(task2.payload.preview, 'Some result', 'without an explicit previewUrl, should fall back to the old last-node-text behavior');
  console.log('✓ an approval node without previewUrl falls back to the original text-preview behavior (backward compatible)');

  restore();
  console.log('\nAll approval preview checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
