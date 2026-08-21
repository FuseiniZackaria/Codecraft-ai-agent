const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadPlugins } = require('../core/pluginLoader');
const { classify } = require('../core/orchestrator/planner');
const orchestrator = require('../core/orchestrator');
const mockProvider = require('../core/providers/mockProvider');
const { WORKSPACE_ROOT } = require('../plugins/filesystem/workspaceSafety');

const CLASSIFY_CODING = '{"category": "coding"}';

// Stub the mock provider's `complete` IN PLACE (mutating the shared
// module-cache singleton), so this test is deterministic without a real API
// key, while still exercising the real plan -> generate -> write -> zip
// pipeline end to end. Reassigning router.selectProvider wouldn't work here -
// CodingAgent destructures `selectProvider` at require-time, so it holds a
// direct function reference, not a live binding back to the router module.
//
// Every request now goes through classifyIntent() FIRST (one extra
// provider.complete() call before the agent's own plan/content calls) -
// `responses` here should be [classification, ...the agent's own responses].
function stubProvider(responses, capture) {
  let call = 0;
  const original = mockProvider.complete;
  mockProvider.complete = async (args) => {
    if (capture) capture.push(args);
    const text = responses[Math.min(call, responses.length - 1)];
    call++;
    return { text, provider: 'mock', costEstimate: 0 };
  };
  return () => { mockProvider.complete = original; };
}

async function main() {
  const plugins = loadPlugins();
  assert(plugins.includes('filesystem'), 'filesystem plugin should load');
  console.log('✓ filesystem plugin registered');

  const buildCheck = classify('Build me a website for a local bakery');
  assert(buildCheck.isCoding, 'build request should be classified as coding');
  assert(!buildCheck.isGithub && !buildCheck.isMarketing, 'should not collide with other categories');
  console.log('✓ "build a website" routes to Coding Agent without colliding with other categories (keyword fallback)');

  const restoreProvider = stubProvider([
    CLASSIFY_CODING,
    JSON.stringify({
      projectName: 'bakery-site',
      summary: 'A simple one-page bakery landing site',
      files: [
        { path: 'index.html', description: 'Landing page with hero and menu section' },
        { path: 'style.css', description: 'Basic styling' },
      ],
    }),
    '<!DOCTYPE html><html><body><h1>Sweet Bakery</h1></body></html>',
    'body { font-family: sans-serif; }',
  ]);

  let task;
  try {
    const [result] = await orchestrator.submitGoal('Build me a website for a local bakery');
    task = result;
  } finally {
    restoreProvider();
  }

  assert.strictEqual(task.status, 'done', `coding task should complete, got: ${JSON.stringify(task.result)}`);
  assert(task.workspaceId, 'task should have a workspaceId set by the agent');
  console.log('✓ coding task completes end to end via the real orchestrator (with LLM classification in front)');

  const projectDir = path.join(WORKSPACE_ROOT, task.workspaceId);
  const indexContent = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf-8');
  const cssContent = fs.readFileSync(path.join(projectDir, 'style.css'), 'utf-8');
  assert(indexContent.includes('Sweet Bakery'), 'index.html should contain the generated content');
  assert(cssContent.includes('font-family'), 'style.css should contain the generated content');
  console.log('✓ generated files actually exist on disk with the real generated content');

  const zipPath = path.join(WORKSPACE_ROOT, `${task.workspaceId}.zip`);
  assert(fs.existsSync(zipPath), 'project zip should exist after build completes');
  console.log('✓ project zip was created');

  const lastStep = task.result[task.result.length - 1];
  assert(lastStep.text.includes('index.html') && lastStep.text.includes('download'), 'summary should list files and a download link');
  console.log('✓ chat-facing summary lists files and a download link');

  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  // 6. When a design brief is present, it must actually reach every file
  // generation call - not just get planned and discarded.
  const capturedCalls = [];
  const designBriefPlan = JSON.stringify({
    projectName: 'design-check',
    summary: 'A design-conscious test page',
    design: {
      palette: [{ name: 'ink', hex: '#1a1a2e' }, { name: 'coral', hex: '#e94560' }],
      typography: { display: 'Fraunces', body: 'Inter' },
      layoutConcept: 'Single centered column with generous whitespace',
      signature: 'A large rotated headline as the hero',
    },
    files: [{ path: 'index.html', description: 'Hero page' }],
  });
  const restoreProvider2 = stubProvider([CLASSIFY_CODING, designBriefPlan, '<!DOCTYPE html><html></html>'], capturedCalls);

  let task2;
  try {
    const [result2] = await orchestrator.submitGoal('Build me a design-conscious test page');
    task2 = result2;
  } finally {
    restoreProvider2();
  }

  assert.strictEqual(task2.status, 'done', 'design-brief task should complete');
  const fileGenCall = capturedCalls[2]; // 0=classification, 1=plan, 2=the actual file generation
  assert(
    fileGenCall.system.includes('#1a1a2e') && fileGenCall.system.includes('Fraunces'),
    'design brief palette/typography should reach the file generation prompt'
  );
  console.log('✓ design brief is threaded into every file generation call, not just planned and discarded');

  fs.rmSync(path.join(WORKSPACE_ROOT, task2.workspaceId), { recursive: true, force: true });
  fs.rmSync(path.join(WORKSPACE_ROOT, `${task2.workspaceId}.zip`), { force: true });

  // 7. Regression check - a plan response truncated by max_tokens must
  // retry with a genuinely LARGER budget, not the same one that just
  // failed (this happened for real: both attempts used the same budget
  // and truncated identically twice).
  let planCalls = 0;
  const originalComplete3 = mockProvider.complete;
  mockProvider.complete = async ({ maxTokens }) => {
    planCalls++;
    if (planCalls === 1) return { text: CLASSIFY_CODING, provider: 'mock', costEstimate: 0 };
    if (planCalls === 2) {
      return { text: '{"projectName": "trunc-test", "files": [{"path": "index.h', truncated: true, provider: 'mock', costEstimate: 0 };
    }
    if (planCalls === 3) {
      assert(maxTokens > 3500, 'retry after truncation must use a larger token budget than the first attempt');
      return {
        text: JSON.stringify({ projectName: 'trunc-test', summary: 'test', files: [{ path: 'index.html', description: 'home' }] }),
        provider: 'mock',
        costEstimate: 0,
      };
    }
    return { text: '<html></html>', provider: 'mock', costEstimate: 0 };
  };

  let task3;
  try {
    const [result3] = await orchestrator.submitGoal('Build a landing page for a truncation test');
    task3 = result3;
  } finally {
    mockProvider.complete = originalComplete3;
  }
  assert.strictEqual(task3.status, 'done', 'should recover from a truncated first plan attempt via a larger retry budget');
  console.log('✓ truncated plan response retries with a genuinely larger token budget, not the same one that just failed');

  fs.rmSync(path.join(WORKSPACE_ROOT, task3.workspaceId), { recursive: true, force: true });
  fs.rmSync(path.join(WORKSPACE_ROOT, `${task3.workspaceId}.zip`), { force: true });

  // 8. Regression check - a FILE CONTENT response (not the plan) truncated
  // by max_tokens must retry with a larger budget and write the complete
  // retried content, never the broken truncated one. This happened for
  // real: the plan step had truncation protection but the per-file
  // generation step had none at all.
  let fileCalls = 0;
  const originalComplete4 = mockProvider.complete;
  mockProvider.complete = async ({ maxTokens }) => {
    fileCalls++;
    if (fileCalls === 1) return { text: CLASSIFY_CODING, provider: 'mock', costEstimate: 0 };
    if (fileCalls === 2) {
      return { text: JSON.stringify({ projectName: 'trunc-file-test', summary: 'test', files: [{ path: 'index.html', description: 'home' }] }), provider: 'mock', costEstimate: 0 };
    }
    if (fileCalls === 3) {
      return { text: '<!DOCTYPE html><html><head><style>body { font', truncated: true, provider: 'mock', costEstimate: 0 };
    }
    assert(maxTokens > 4000, 'file-content retry after truncation must use a larger budget than the first attempt');
    return { text: '<!DOCTYPE html><html><body>complete page</body></html>', provider: 'mock', costEstimate: 0 };
  };

  let task4;
  try {
    const [result4] = await orchestrator.submitGoal('Build a landing page for a truncation-file test');
    task4 = result4;
  } finally {
    mockProvider.complete = originalComplete4;
  }
  assert.strictEqual(task4.status, 'done', 'should recover from truncated file content via a larger retry budget');
  const writtenContent = fs.readFileSync(path.join(WORKSPACE_ROOT, task4.workspaceId, 'index.html'), 'utf-8');
  assert(writtenContent.includes('complete page'), 'the file written to disk must be the complete retried content, never the truncated one');
  console.log('✓ truncated file content retries with a larger budget and writes only the complete result');

  fs.rmSync(path.join(WORKSPACE_ROOT, task4.workspaceId), { recursive: true, force: true });
  fs.rmSync(path.join(WORKSPACE_ROOT, `${task4.workspaceId}.zip`), { force: true });

  // 9. If a file genuinely can't be generated within budget even after
  // retrying, the agent must fail loudly - never silently write a
  // half-written, broken file to disk.
  let alwaysTruncateCalls = 0;
  const originalComplete5 = mockProvider.complete;
  mockProvider.complete = async () => {
    alwaysTruncateCalls++;
    if (alwaysTruncateCalls === 1) return { text: CLASSIFY_CODING, provider: 'mock', costEstimate: 0 };
    if (alwaysTruncateCalls === 2) {
      return { text: JSON.stringify({ projectName: 'always-truncates', summary: 'test', files: [{ path: 'index.html', description: 'home' }] }), provider: 'mock', costEstimate: 0 };
    }
    return { text: '<html>incomplete', truncated: true, provider: 'mock', costEstimate: 0 };
  };

  let task5;
  try {
    const [result5] = await orchestrator.submitGoal('Build a landing page that always truncates');
    task5 = result5;
  } finally {
    mockProvider.complete = originalComplete5;
  }
  assert.strictEqual(task5.status, 'failed', 'should fail cleanly, not write a broken file, when generation can\'t complete within budget');
  const projectDirExists = fs.existsSync(path.join(WORKSPACE_ROOT, task5.workspaceId, 'index.html'));
  assert(!projectDirExists, 'no broken/incomplete file should ever be written to disk');
  console.log('✓ never writes a broken, incomplete file to disk - fails loudly instead');

  fs.rmSync(path.join(WORKSPACE_ROOT, task5.workspaceId), { recursive: true, force: true });

  // 10. Regression check - the exact bug reported for real: HTML generated
  // without a <link> to its sibling CSS file must have one deterministically
  // injected, so styling actually applies even if the model forgot to
  // reference it.
  let linkTestCalls = 0;
  const originalComplete6 = mockProvider.complete;
  mockProvider.complete = async () => {
    linkTestCalls++;
    if (linkTestCalls === 1) return { text: CLASSIFY_CODING, provider: 'mock', costEstimate: 0 };
    if (linkTestCalls === 2) {
      return {
        text: JSON.stringify({
          projectName: 'link-regression-test',
          summary: 'test',
          files: [{ path: 'index.html', description: 'home' }, { path: 'style.css', description: 'styles' }],
        }),
        provider: 'mock',
        costEstimate: 0,
      };
    }
    if (linkTestCalls === 3) {
      // The model forgets the <link> tag entirely - exactly what was reported.
      return { text: '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>', provider: 'mock', costEstimate: 0 };
    }
    return { text: 'body { color: red; }', provider: 'mock', costEstimate: 0 };
  };

  let task6;
  try {
    const [result6] = await orchestrator.submitGoal('Build a landing page for a link regression test');
    task6 = result6;
  } finally {
    mockProvider.complete = originalComplete6;
  }
  assert.strictEqual(task6.status, 'done');
  const html6 = fs.readFileSync(path.join(WORKSPACE_ROOT, task6.workspaceId, 'index.html'), 'utf-8');
  assert(html6.includes('href="style.css"'), 'stylesheet link must be present even when the model forgot to write it');
  console.log('✓ HTML missing a <link> to its sibling CSS gets one deterministically injected');

  fs.rmSync(path.join(WORKSPACE_ROOT, task6.workspaceId), { recursive: true, force: true });
  fs.rmSync(path.join(WORKSPACE_ROOT, `${task6.workspaceId}.zip`), { force: true });

  console.log('\nAll coding agent integration checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
