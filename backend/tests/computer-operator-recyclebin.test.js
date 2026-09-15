const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const { moveToRecycleBin, isAllowedRootItself } = require('../core/computerOperator/recycleBin');

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-operator-recyclebin-test-'));
const TEST_ROOT = path.join(SANDBOX_ROOT, 'allowed-root');
const OUTSIDE_ROOT = path.join(SANDBOX_ROOT, 'not-allowed');

function setupFixtures() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  fs.mkdirSync(OUTSIDE_ROOT, { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'a-real-folder'), { recursive: true });

  fs.writeFileSync(path.join(TEST_ROOT, 'old-report.pdf'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'duplicate-1.txt'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'duplicate-2.txt'), 'test');
}

function cleanupFixtures() {
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
}

function stubRecycle(fn) {
  const recycleBinModule = require('../core/computerOperator/recycleBin');
  const original = recycleBinModule.sendToRecycleBinOS;
  recycleBinModule.sendToRecycleBinOS = fn;
  return () => { recycleBinModule.sendToRecycleBinOS = original; };
}

async function main() {
  const originalRoots = config.computerOperator.allowedRoots;
  setupFixtures();

  try {
    config.computerOperator.allowedRoots = [TEST_ROOT];

    let recycledPath = null;
    let recycledIsDir = null;
    let restore = stubRecycle(async (p, isDir) => { recycledPath = p; recycledIsDir = isDir; });
    let result = await moveToRecycleBin(path.join(TEST_ROOT, 'old-report.pdf'));
    restore();
    assert.strictEqual(result.status, 'recycled');
    assert.strictEqual(recycledPath, path.join(TEST_ROOT, 'old-report.pdf'));
    assert.strictEqual(recycledIsDir, false);
    console.log('✓ moveToRecycleBin: a real, allowed file passes all checks and reaches the actual OS recycle step');

    restore = stubRecycle(async (p, isDir) => { recycledPath = p; recycledIsDir = isDir; });
    result = await moveToRecycleBin(path.join(TEST_ROOT, 'a-real-folder'));
    restore();
    assert.strictEqual(result.wasDirectory, true);
    assert.strictEqual(recycledIsDir, true, 'the OS-level call must be told this is a directory, not a file');
    console.log('✓ moveToRecycleBin: correctly handles folders too, flagging isDirectory correctly for the OS call');

    let recycleCalled = false;
    restore = stubRecycle(async () => { recycleCalled = true; });
    await assert.rejects(() => moveToRecycleBin(TEST_ROOT), /refusing to delete an entire allowed root/);
    restore();
    assert.strictEqual(recycleCalled, false, 'the OS recycle step must NEVER be reached when the target is an allowed root itself');
    console.log('✓ moveToRecycleBin: CRITICAL - refuses to delete an allowed root itself, never even attempts the OS call');

    assert.strictEqual(isAllowedRootItself(TEST_ROOT), true);
    assert.strictEqual(isAllowedRootItself(path.join(TEST_ROOT, 'old-report.pdf')), false, 'a file INSIDE an allowed root is not the root itself');
    console.log('✓ isAllowedRootItself: correctly distinguishes the root itself from things inside it');

    recycleCalled = false;
    restore = stubRecycle(async () => { recycleCalled = true; });
    await assert.rejects(() => moveToRecycleBin(path.join(OUTSIDE_ROOT, 'anything.txt')), /outside the allowed folders/);
    restore();
    assert.strictEqual(recycleCalled, false);
    console.log('✓ moveToRecycleBin: a path outside the allowlist is refused, OS call never attempted');

    await assert.rejects(() => moveToRecycleBin(path.join(TEST_ROOT, 'does-not-exist.txt')), /does not exist/);
    console.log('✓ moveToRecycleBin: a nonexistent path produces a clear, honest error');

    await assert.rejects(() => moveToRecycleBin(path.join(TEST_ROOT, 'evil".txt')), /quote character/);
    await assert.rejects(() => moveToRecycleBin(path.join(TEST_ROOT, "evil'.txt")), /quote character/);
    console.log('✓ moveToRecycleBin: paths containing either quote character are refused (shell-injection defense, broader than Stage 3 since this OS call uses both quote styles)');

    config.computerOperator.allowedRoots = [];
    await assert.rejects(() => moveToRecycleBin(path.join(TEST_ROOT, 'old-report.pdf')), /not configured yet/);
    console.log('✓ moveToRecycleBin: refuses clearly when no folders are configured at all');

    config.computerOperator.allowedRoots = [TEST_ROOT];
    const deleteAction = require('../plugins/computer/actions/deleteToRecycleBin');
    assert.strictEqual(deleteAction.irreversible, true, 'deletion MUST be marked irreversible - this is what routes it through the approval gate');
    assert.strictEqual(deleteAction.permission, 'computer.delete');
    console.log('✓ plugin action: computer.deleteToRecycleBin is correctly marked irreversible=true');

    restore = stubRecycle(async () => {});
    let actionResult = await deleteAction.run({ paths: [path.join(TEST_ROOT, 'duplicate-1.txt'), path.join(TEST_ROOT, 'duplicate-2.txt')] });
    restore();
    assert.strictEqual(actionResult.succeeded, 2);
    assert.strictEqual(actionResult.failed, 0);
    console.log('✓ plugin action: a real multi-file batch succeeds, reporting per-item results');

    const originalCap = config.computerOperator.maxDeleteBatch;
    config.computerOperator.maxDeleteBatch = 2;
    recycleCalled = false;
    restore = stubRecycle(async () => { recycleCalled = true; });
    await assert.rejects(
      () => deleteAction.run({ paths: ['a', 'b', 'c'] }),
      /safety cap is 2/
    );
    restore();
    assert.strictEqual(recycleCalled, false, 'exceeding the batch cap must refuse the ENTIRE batch before touching anything, not just truncate it');
    config.computerOperator.maxDeleteBatch = originalCap;
    console.log('✓ plugin action: CRITICAL - exceeding the batch cap refuses the entire request, nothing is deleted, not even a partial batch');

    restore = stubRecycle(async (p) => {
      if (p.includes('duplicate-1')) throw new Error('simulated OS failure for this one file');
    });
    actionResult = await deleteAction.run({ paths: [path.join(TEST_ROOT, 'duplicate-1.txt'), path.join(TEST_ROOT, 'a-real-folder')] });
    restore();
    assert.strictEqual(actionResult.succeeded, 1);
    assert.strictEqual(actionResult.failed, 1);
    assert(actionResult.results.find((r) => r.status === 'failed').error.includes('simulated OS failure'));
    console.log('✓ plugin action: a partial failure in a batch is reported accurately per-item, not silently swallowed or failing the whole batch');

    config.computerOperator.allowedRoots = [];
    await assert.rejects(() => deleteAction.run({ paths: ['x'] }), /No folders are configured/);
    config.computerOperator.allowedRoots = [TEST_ROOT];
    console.log('✓ plugin action: refuses clearly when no folders are configured');

    await assert.rejects(() => deleteAction.run({ paths: [] }), /non-empty "paths"/);
    await assert.rejects(() => deleteAction.run({}), /non-empty "paths"/);
    console.log('✓ plugin action: refuses an empty or missing paths array, rather than silently doing nothing');

    // === ComputerOperatorAgent: "delete" mode - the approval-gate integration ===
    // These are the most important tests in this whole stage: proving that
    // asking the agent to delete something NEVER actually deletes anything
    // itself - it only ever creates a pending approval task.

    config.computerOperator.allowedRoots = [TEST_ROOT];
    const mockProvider = require('../core/providers/mockProvider');
    const aiProvider = require('../core/providers/aiProvider');
    function stubProviderSequence(responses) {
      let call = 0;
      const respond = async () => ({ text: responses[Math.min(call++, responses.length - 1)], provider: 'mock', costEstimate: 0 });
      const originalMock = mockProvider.complete;
      const originalAi = aiProvider.complete;
      mockProvider.complete = respond;
      aiProvider.complete = respond;
      return () => { mockProvider.complete = originalMock; aiProvider.complete = originalAi; };
    }

    const ComputerOperatorAgent = require('../agents/computer-operator/ComputerOperatorAgent');
    const memory = require('../memory');
    const agent = new ComputerOperatorAgent();

    // Case 11: THE MOST CRITICAL TEST - asking to delete a real, unambiguous file
    // creates a pending_approval task and does NOT actually delete anything.
    let osRecycleCalled = false;
    let restoreRecycle = stubRecycle(async () => { osRecycleCalled = true; });
    let restoreExtract = stubProviderSequence(['{"mode": "delete", "query": "", "extensions": [], "folderName": "", "fileName": "old-report", "minSizeMB": 0, "minAgeDays": 0}']);
    await agent.plan({ instruction: 'delete old-report.pdf', history: [] });
    restoreExtract();
    restoreRecycle();

    assert.strictEqual(osRecycleCalled, false, 'CRITICAL: asking the agent to delete something must NEVER actually reach the OS recycle step - only approving the resulting task should');
    assert(fs.existsSync(path.join(TEST_ROOT, 'old-report.pdf')), 'CRITICAL: the real file must still exist on disk - a delete REQUEST is not a delete');

    const allTasks = await memory.listTasks();
    const deleteTask = allTasks.find((t) => t.instruction.includes('old-report.pdf'));
    assert(deleteTask, 'a real pending_approval task should have been created for review');
    assert.strictEqual(deleteTask.status, 'pending_approval');
    assert.strictEqual(deleteTask.toolCall.tool, 'computer.deleteToRecycleBin');
    assert.deepStrictEqual(deleteTask.payload.paths, [path.join(TEST_ROOT, 'old-report.pdf')]);
    console.log('✓ ComputerOperatorAgent: CRITICAL - "delete X" creates a real pending_approval task and does NOT delete anything itself; the file still exists on disk');

    // Case 12: only AFTER explicitly simulating what approveTask() would do (calling the
    // actual gated tool with the task's payload) does the file actually get recycled.
    let approvedRecyclePath = null;
    restoreRecycle = stubRecycle(async (p) => { approvedRecyclePath = p; });
    const deleteAction2 = require('../plugins/computer/actions/deleteToRecycleBin');
    await deleteAction2.run(deleteTask.payload); // this is what orchestrator.approveTask would do on a real "Approve" click
    restoreRecycle();
    assert.strictEqual(approvedRecyclePath, path.join(TEST_ROOT, 'old-report.pdf'));
    console.log('✓ ComputerOperatorAgent: only after simulating the actual "Approve" action does the real recycle step get reached');

    // Case 13: ambiguous multiple matches never create an approval task for either one.
    fs.writeFileSync(path.join(TEST_ROOT, 'duplicate-3.txt'), 'test'); // now "duplicate" could match multiple
    const tasksBefore = (await memory.listTasks()).length;
    restoreExtract = stubProviderSequence(['{"mode": "delete", "query": "", "extensions": [], "folderName": "", "fileName": "duplicate", "minSizeMB": 0, "minAgeDays": 0}']);
    const ambiguousSteps = await agent.plan({ instruction: 'delete the duplicate file', history: [] });
    restoreExtract();
    const tasksAfter = (await memory.listTasks()).length;
    assert.strictEqual(tasksAfter, tasksBefore, 'an ambiguous delete request must NEVER create an approval task for any candidate - it must ask for clarification instead');
    assert.strictEqual(ambiguousSteps[0].type, 'llm_call');
    assert(ambiguousSteps[0].instruction.includes('nothing has been deleted yet'));
    console.log('✓ ComputerOperatorAgent: an ambiguous "delete X" (multiple matches) creates NO approval task at all, asks for clarification instead');

    // Case 14: a delete request for something that doesn't exist creates no approval task.
    const tasksBefore2 = (await memory.listTasks()).length;
    restoreExtract = stubProviderSequence(['{"mode": "delete", "query": "", "extensions": [], "folderName": "", "fileName": "doesnotexistatall", "minSizeMB": 0, "minAgeDays": 0}']);
    await agent.plan({ instruction: 'delete doesnotexistatall.pdf', history: [] });
    restoreExtract();
    const tasksAfter2 = (await memory.listTasks()).length;
    assert.strictEqual(tasksAfter2, tasksBefore2, 'a delete request for a nonexistent file must never create an approval task');
    console.log('✓ ComputerOperatorAgent: a delete request for a nonexistent file creates no approval task');

    // Case 15: deleteFolder mode also correctly creates an approval task, not a direct action.
    osRecycleCalled = false;
    restoreRecycle = stubRecycle(async () => { osRecycleCalled = true; });
    restoreExtract = stubProviderSequence(['{"mode": "deleteFolder", "query": "", "extensions": [], "folderName": "a-real-folder", "fileName": "", "minSizeMB": 0, "minAgeDays": 0}']);
    await agent.plan({ instruction: 'delete the a-real-folder folder', history: [] });
    restoreExtract();
    restoreRecycle();
    assert.strictEqual(osRecycleCalled, false);
    assert(fs.existsSync(path.join(TEST_ROOT, 'a-real-folder')), 'the folder must still exist - a request is not a deletion');
    const folderDeleteTask = (await memory.listTasks()).find((t) => t.instruction.includes('a-real-folder'));
    assert(folderDeleteTask, 'a real approval task should exist for the folder deletion request');
    assert.strictEqual(folderDeleteTask.status, 'pending_approval');
    console.log('✓ ComputerOperatorAgent: "delete [folder]" also correctly creates an approval task rather than deleting directly');

    console.log('\nAll computer-operator Stage 8 (Recycle Bin deletion) checks passed.');
  } finally {
    config.computerOperator.allowedRoots = originalRoots;
    cleanupFixtures();
  }
}

main().catch((err) => {
  console.error('✗ computer-operator-recyclebin.test.js failed:', err);
  process.exit(1);
});