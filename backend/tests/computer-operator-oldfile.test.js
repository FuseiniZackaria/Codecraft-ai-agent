const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const { findOldFiles } = require('../core/computerOperator/oldFileAnalysis');

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-operator-oldfile-test-'));
const TEST_ROOT = path.join(SANDBOX_ROOT, 'allowed-root');
const OUTSIDE_ROOT = path.join(SANDBOX_ROOT, 'not-allowed');

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

function setAge(filePath, daysOld) {
  const t = new Date(now - daysOld * DAY_MS);
  fs.utimesSync(filePath, t, t);
}

function setupFixtures() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  fs.mkdirSync(OUTSIDE_ROOT, { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'subdir'), { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'node_modules'), { recursive: true });

  fs.writeFileSync(path.join(TEST_ROOT, 'brand-new.txt'), 'x');
  setAge(path.join(TEST_ROOT, 'brand-new.txt'), 1);

  fs.writeFileSync(path.join(TEST_ROOT, 'medium-age.txt'), 'x');
  setAge(path.join(TEST_ROOT, 'medium-age.txt'), 100);

  fs.writeFileSync(path.join(TEST_ROOT, 'subdir', 'ancient.txt'), 'x');
  setAge(path.join(TEST_ROOT, 'subdir', 'ancient.txt'), 1000);

  fs.writeFileSync(path.join(TEST_ROOT, 'node_modules', 'old-but-excluded.txt'), 'x');
  setAge(path.join(TEST_ROOT, 'node_modules', 'old-but-excluded.txt'), 2000);

  fs.writeFileSync(path.join(OUTSIDE_ROOT, 'outside-ancient.txt'), 'x');
  setAge(path.join(OUTSIDE_ROOT, 'outside-ancient.txt'), 2000);
}

function cleanupFixtures() {
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
}

async function main() {
  const originalRoots = config.computerOperator.allowedRoots;
  setupFixtures();

  try {
    config.computerOperator.allowedRoots = [TEST_ROOT];

    let result = findOldFiles({});
    const names = result.results.map((r) => r.name);
    assert.strictEqual(names[0], 'ancient.txt', 'the oldest file should be first');
    assert.strictEqual(names[names.length - 1], 'brand-new.txt', 'the newest file should be last');
    for (let i = 1; i < result.results.length; i++) {
      assert(result.results[i - 1].ageDays >= result.results[i].ageDays, 'results must be sorted oldest to newest');
    }
    console.log('✓ findOldFiles: results are correctly sorted oldest-first');

    const ancient = result.results.find((r) => r.name === 'ancient.txt');
    assert(Math.abs(ancient.ageDays - 1000) <= 1, `ageDays should be approximately 1000, got ${ancient.ageDays}`);
    console.log('✓ findOldFiles: ageDays is calculated correctly from the real file modification time');

    assert(!names.includes('old-but-excluded.txt'), 'files inside node_modules must never appear, regardless of age');
    console.log('✓ findOldFiles: never includes files inside excluded directories (node_modules), even ancient ones');

    assert(!names.includes('outside-ancient.txt'), 'a very old file outside the allowlist must never appear');
    console.log('✓ findOldFiles: never includes files outside the allowlist, regardless of age');

    result = findOldFiles({ minAgeDays: 500 });
    assert.deepStrictEqual(result.results.map((r) => r.name), ['ancient.txt'], 'only files at/above the age threshold should be included');
    console.log('✓ findOldFiles: minAgeDays threshold correctly excludes files that are not old enough');

    result = findOldFiles({ maxResults: 1 });
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].name, 'ancient.txt');
    console.log('✓ findOldFiles: maxResults correctly caps the result list to the N oldest files');

    result = findOldFiles({ minAgeDays: 999999 });
    assert.strictEqual(result.results.length, 0);
    assert(result.totalScanned >= 3, 'totalScanned should count every real file examined, even when none met the threshold');
    console.log('✓ findOldFiles: totalScanned honestly reflects everything examined, independent of the filtered results');

    result = findOldFiles({ roots: [OUTSIDE_ROOT] });
    assert.strictEqual(result.results.length, 0);
    assert(result.skippedFolders.some((s) => s.includes('outside allowed roots')));
    console.log('✓ findOldFiles: an explicitly requested root outside the allowlist is refused and recorded, never scanned');

    config.computerOperator.allowedRoots = [TEST_ROOT];
    const toolAction = require('../plugins/computer/actions/findOldFiles');
    assert.strictEqual(toolAction.irreversible, false);
    const actionResult = await toolAction.run({ maxResults: 5 });
    assert(actionResult.results.length > 0, 'plugin action should return real results through the actual function');
    console.log('✓ plugin action: computer.findOldFiles correctly wraps the core logic');

    config.computerOperator.allowedRoots = [];
    await assert.rejects(() => toolAction.run({}), /No folders are configured/);
    console.log('✓ plugin action: refuses clearly when no folders are configured');

    // === ComputerOperatorAgent: "oldFiles" mode planning ===

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

    let restoreExtract = stubProviderSequence(['{"mode": "oldFiles", "query": "", "extensions": [], "folderName": "", "fileName": "", "minSizeMB": 0, "minAgeDays": 0}']);
    let steps = await agent.plan({ instruction: 'find my oldest files', history: [] });
    restoreExtract();
    assert.strictEqual(steps[0].type, 'tool_call');
    assert.strictEqual(steps[0].tool, 'computer.findOldFiles');
    console.log('✓ ComputerOperatorAgent: "find my oldest files" plans a real findOldFiles call');

    restoreExtract = stubProviderSequence(['{"mode": "oldFiles", "query": "", "extensions": [], "folderName": "", "fileName": "", "minSizeMB": 0, "minAgeDays": 365}']);
    steps = await agent.plan({ instruction: "show me files i haven't touched in a year", history: [] });
    restoreExtract();
    assert.strictEqual(steps[0].args.minAgeDays, 365, 'an explicitly mentioned age threshold should be passed through');
    console.log('✓ ComputerOperatorAgent: "files I haven\'t touched in a year" correctly passes minAgeDays=365 through');

    console.log('\nAll computer-operator Stage 6 (old-file analysis) checks passed.');
  } finally {
    config.computerOperator.allowedRoots = originalRoots;
    cleanupFixtures();
  }
}

main().catch((err) => {
  console.error('✗ computer-operator-oldfile.test.js failed:', err);
  process.exit(1);
});