const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const { findLargeFiles } = require('../core/computerOperator/largeFileAnalysis');

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-operator-largefile-test-'));
const TEST_ROOT = path.join(SANDBOX_ROOT, 'allowed-root');
const OUTSIDE_ROOT = path.join(SANDBOX_ROOT, 'not-allowed');

function setupFixtures() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  fs.mkdirSync(OUTSIDE_ROOT, { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'subdir'), { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'node_modules'), { recursive: true });

  fs.writeFileSync(path.join(TEST_ROOT, 'tiny.txt'), 'a'.repeat(10));
  fs.writeFileSync(path.join(TEST_ROOT, 'medium.txt'), 'a'.repeat(1000));
  fs.writeFileSync(path.join(TEST_ROOT, 'subdir', 'huge.mp4'), 'a'.repeat(5000));
  fs.writeFileSync(path.join(TEST_ROOT, 'node_modules', 'should-be-excluded.bin'), 'a'.repeat(9999));
  fs.writeFileSync(path.join(OUTSIDE_ROOT, 'outside-huge.bin'), 'a'.repeat(9999));
}

function cleanupFixtures() {
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
}

async function main() {
  const originalRoots = config.computerOperator.allowedRoots;
  setupFixtures();

  try {
    config.computerOperator.allowedRoots = [TEST_ROOT];

    let result = findLargeFiles({});
    const names = result.results.map((r) => r.name);
    assert.strictEqual(names[0], 'huge.mp4', 'the largest file should be first');
    assert.strictEqual(names[names.length - 1], 'tiny.txt', 'the smallest file should be last');
    for (let i = 1; i < result.results.length; i++) {
      assert(result.results[i - 1].sizeBytes >= result.results[i].sizeBytes, 'results must be sorted largest to smallest');
    }
    console.log('✓ findLargeFiles: results are correctly sorted largest-first');

    assert(!names.includes('should-be-excluded.bin'), 'files inside node_modules must never appear, regardless of size');
    console.log('✓ findLargeFiles: never includes files inside excluded directories (node_modules), even the biggest ones');

    assert(!names.includes('outside-huge.bin'), 'a huge file outside the allowlist must never appear');
    console.log('✓ findLargeFiles: never includes files outside the allowlist, regardless of size');

    result = findLargeFiles({ minSizeBytes: 2000 });
    assert.deepStrictEqual(result.results.map((r) => r.name), ['huge.mp4'], 'only files at/above the threshold should be included');
    console.log('✓ findLargeFiles: minSizeBytes threshold correctly excludes smaller files');

    result = findLargeFiles({ maxResults: 1 });
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].name, 'huge.mp4', 'with maxResults=1, only the single largest file should be returned');
    console.log('✓ findLargeFiles: maxResults correctly caps the result list to the N largest files');

    result = findLargeFiles({ minSizeBytes: 999999999 });
    assert.strictEqual(result.results.length, 0);
    assert(result.totalScanned >= 3, 'totalScanned should count every real file examined, even when none met the threshold');
    assert(result.totalSizeBytes > 0, 'totalSizeBytes should reflect real bytes scanned, even when the results list is empty');
    console.log('✓ findLargeFiles: totalScanned/totalSizeBytes honestly reflect everything examined, independent of the filtered results list');

    result = findLargeFiles({ roots: [OUTSIDE_ROOT] });
    assert.strictEqual(result.results.length, 0);
    assert(result.skippedFolders.some((s) => s.includes('outside allowed roots')));
    console.log('✓ findLargeFiles: an explicitly requested root outside the allowlist is refused and recorded, never scanned');

    config.computerOperator.allowedRoots = [TEST_ROOT];
    const toolAction = require('../plugins/computer/actions/findLargeFiles');
    assert.strictEqual(toolAction.irreversible, false);
    const actionResult = await toolAction.run({ minSizeMB: 0, maxResults: 5 });
    assert(actionResult.results.length > 0, 'plugin action should return real results through the actual function');
    console.log('✓ plugin action: computer.findLargeFiles correctly wraps the core logic');

    const mbResult = await toolAction.run({ minSizeMB: 1 });
    assert.strictEqual(mbResult.results.length, 0, 'a 1MB threshold should correctly exclude all these tiny test fixture files');
    console.log('✓ plugin action: minSizeMB is correctly converted to bytes before filtering');

    config.computerOperator.allowedRoots = [];
    await assert.rejects(() => toolAction.run({}), /No folders are configured/);
    console.log('✓ plugin action: refuses clearly when no folders are configured');

    // === ComputerOperatorAgent: "largeFiles" mode planning ===

    config.computerOperator.allowedRoots = [TEST_ROOT];
    const mockProvider = require('../core/providers/mockProvider');
    function stubProviderSequence(responses) {
      let call = 0;
      const original = mockProvider.complete;
      mockProvider.complete = async () => ({ text: responses[Math.min(call++, responses.length - 1)], provider: 'mock', costEstimate: 0 });
      return () => { mockProvider.complete = original; };
    }

    const ComputerOperatorAgent = require('../agents/computer-operator/ComputerOperatorAgent');
    const agent = new ComputerOperatorAgent();

    let restoreExtract = stubProviderSequence(['{"mode": "largeFiles", "query": "", "extensions": [], "folderName": "", "fileName": "", "minSizeMB": 0}']);
    let steps = await agent.plan({ instruction: "what's taking up space on my computer", history: [] });
    restoreExtract();
    assert.strictEqual(steps[0].type, 'tool_call');
    assert.strictEqual(steps[0].tool, 'computer.findLargeFiles');
    assert.deepStrictEqual(steps[0].args, {}, 'no minSizeMB should be passed through when none was mentioned');
    console.log('✓ ComputerOperatorAgent: "what\'s taking up space" plans a real findLargeFiles call with no forced threshold');

    restoreExtract = stubProviderSequence(['{"mode": "largeFiles", "query": "", "extensions": [], "folderName": "", "fileName": "", "minSizeMB": 500}']);
    steps = await agent.plan({ instruction: 'show me files over 500MB', history: [] });
    restoreExtract();
    assert.strictEqual(steps[0].args.minSizeMB, 500, 'an explicitly mentioned size threshold should be passed through');
    console.log('✓ ComputerOperatorAgent: "show me files over 500MB" correctly passes the threshold through');

    console.log('\nAll computer-operator Stage 5 (large-file analysis) checks passed.');
  } finally {
    config.computerOperator.allowedRoots = originalRoots;
    cleanupFixtures();
  }
}

main().catch((err) => {
  console.error('✗ computer-operator-largefile.test.js failed:', err);
  process.exit(1);
});