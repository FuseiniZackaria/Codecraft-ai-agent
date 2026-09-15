const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const { findDuplicateFiles } = require('../core/computerOperator/duplicateDetection');

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-operator-dup-test-'));
const TEST_ROOT = path.join(SANDBOX_ROOT, 'allowed-root');
const OUTSIDE_ROOT = path.join(SANDBOX_ROOT, 'not-allowed');

function setupFixtures() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  fs.mkdirSync(OUTSIDE_ROOT, { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'subdir'), { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'node_modules'), { recursive: true });

  const contentA = 'This is the exact same content, byte for byte.'.repeat(50);
  fs.writeFileSync(path.join(TEST_ROOT, 'report.pdf'), contentA);
  fs.writeFileSync(path.join(TEST_ROOT, 'subdir', 'report-copy.pdf'), contentA);
  fs.writeFileSync(path.join(TEST_ROOT, 'report-backup.pdf'), contentA);

  const sameLength1 = 'AAAAAAAAAA';
  const sameLength2 = 'BBBBBBBBBB';
  fs.writeFileSync(path.join(TEST_ROOT, 'same-size-1.txt'), sameLength1);
  fs.writeFileSync(path.join(TEST_ROOT, 'same-size-2.txt'), sameLength2);

  fs.writeFileSync(path.join(TEST_ROOT, 'unique.txt'), 'nothing else matches this content anywhere');

  fs.writeFileSync(path.join(TEST_ROOT, 'node_modules', 'excluded-dup.pdf'), contentA);
  fs.writeFileSync(path.join(OUTSIDE_ROOT, 'outside-dup.pdf'), contentA);

  fs.writeFileSync(path.join(TEST_ROOT, 'empty1.txt'), '');
  fs.writeFileSync(path.join(TEST_ROOT, 'empty2.txt'), '');
}

function cleanupFixtures() {
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
}

async function main() {
  const originalRoots = config.computerOperator.allowedRoots;
  setupFixtures();

  try {
    config.computerOperator.allowedRoots = [TEST_ROOT];

    let result = findDuplicateFiles({});
    const reportGroup = result.duplicateGroups.find((g) => g.files.some((f) => f.name === 'report.pdf'));
    assert(reportGroup, 'the genuine duplicate group should be found');
    assert.strictEqual(reportGroup.files.length, 3, 'all three identical copies should be grouped together, not just a pair');
    const namesInGroup = reportGroup.files.map((f) => f.name).sort();
    assert.deepStrictEqual(namesInGroup, ['report-backup.pdf', 'report-copy.pdf', 'report.pdf']);
    console.log('✓ findDuplicateFiles: correctly groups all 3 identical copies together, not just pairs');

    const falsePositiveGroup = result.duplicateGroups.find((g) => g.files.some((f) => f.name.startsWith('same-size')));
    assert(!falsePositiveGroup, 'files that merely SHARE A SIZE but have different content must never be flagged as duplicates');
    console.log('✓ findDuplicateFiles: same-size-but-different-content files are correctly NOT flagged (proves real content hashing, not just size matching)');

    const uniqueAppears = result.duplicateGroups.some((g) => g.files.some((f) => f.name === 'unique.txt'));
    assert.strictEqual(uniqueAppears, false, 'a genuinely unique file must never appear in any duplicate group');
    console.log('✓ findDuplicateFiles: a genuinely unique file never appears in any duplicate group');

    const emptyAppears = result.duplicateGroups.some((g) => g.files.some((f) => f.name.startsWith('empty')));
    assert.strictEqual(emptyAppears, false, 'empty files must never be flagged as duplicates of each other');
    console.log('✓ findDuplicateFiles: empty files are never flagged as duplicates of each other');

    const excludedAppears = result.duplicateGroups.some((g) => g.files.some((f) => f.path.includes('node_modules')));
    assert.strictEqual(excludedAppears, false, 'a duplicate inside an excluded folder must never surface');
    console.log('✓ findDuplicateFiles: a duplicate inside an excluded directory (node_modules) never surfaces');

    const outsideAppears = result.duplicateGroups.some((g) => g.files.some((f) => f.path.includes(OUTSIDE_ROOT)));
    assert.strictEqual(outsideAppears, false, 'a duplicate outside the allowlist must never surface');
    console.log('✓ findDuplicateFiles: a duplicate outside the allowlist never surfaces');

    const contentSize = Buffer.byteLength('This is the exact same content, byte for byte.'.repeat(50));
    assert.strictEqual(result.wastedBytes, contentSize * 2, 'wastedBytes should be (3 copies - 1) * size for the one real duplicate group');
    console.log('✓ findDuplicateFiles: wastedBytes is calculated correctly as (copies - 1) * size');

    result = findDuplicateFiles({ maxFileSizeBytes: 5 });
    assert.strictEqual(result.duplicateGroups.length, 0, 'with a tiny size cap, nothing should be hashed/grouped');
    assert(result.skippedLargeFiles.length > 0, 'files skipped for being too large should be reported, not silently dropped');
    console.log('✓ findDuplicateFiles: maxFileSizeBytes correctly skips large files and reports them separately, never silently');

    result = findDuplicateFiles({ roots: [OUTSIDE_ROOT] });
    assert.strictEqual(result.duplicateGroups.length, 0);
    assert(result.skippedFolders.some((s) => s.includes('outside allowed roots')));
    console.log('✓ findDuplicateFiles: an explicitly requested root outside the allowlist is refused and recorded');

    config.computerOperator.allowedRoots = [TEST_ROOT];
    const toolAction = require('../plugins/computer/actions/findDuplicateFiles');
    assert.strictEqual(toolAction.irreversible, false);
    const actionResult = await toolAction.run({});
    assert(actionResult.duplicateGroups.length > 0, 'plugin action should return real duplicate groups through the actual function');
    console.log('✓ plugin action: computer.findDuplicateFiles correctly wraps the core logic');

    config.computerOperator.allowedRoots = [];
    await assert.rejects(() => toolAction.run({}), /No folders are configured/);
    console.log('✓ plugin action: refuses clearly when no folders are configured');

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

    const restoreExtract = stubProviderSequence(['{"mode": "duplicates", "query": "", "extensions": [], "folderName": "", "fileName": "", "minSizeMB": 0, "minAgeDays": 0}']);
    const steps = await agent.plan({ instruction: 'find duplicate files on my computer', history: [] });
    restoreExtract();
    assert.strictEqual(steps[0].type, 'tool_call');
    assert.strictEqual(steps[0].tool, 'computer.findDuplicateFiles');
    console.log('✓ ComputerOperatorAgent: "find duplicate files" plans a real findDuplicateFiles call');

    console.log('\nAll computer-operator Stage 7 (duplicate detection) checks passed.');
  } finally {
    config.computerOperator.allowedRoots = originalRoots;
    cleanupFixtures();
  }
}

main().catch((err) => {
  console.error('✗ computer-operator-duplicates.test.js failed:', err);
  process.exit(1);
});
