const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const { openFile, isBlockedExtension, BLOCKED_EXTENSIONS } = require('../core/computerOperator/openFile');

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-operator-openfile-test-'));
const TEST_ROOT = path.join(SANDBOX_ROOT, 'allowed-root');
const OUTSIDE_ROOT = path.join(SANDBOX_ROOT, 'not-allowed');

function setupFixtures() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  fs.mkdirSync(OUTSIDE_ROOT, { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'a-real-folder'), { recursive: true });

  fs.writeFileSync(path.join(TEST_ROOT, 'resume.pdf'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'photo.jpg'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'notes.txt'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'setup.exe'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'script.bat'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'install.ps1'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'macro.vbs'), 'test');
  fs.writeFileSync(path.join(OUTSIDE_ROOT, 'secret.pdf'), 'test');
}

function cleanupFixtures() {
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
}

function stubLaunch(fn) {
  const openFileModule = require('../core/computerOperator/openFile');
  const original = openFileModule.launchWithDefaultApp;
  openFileModule.launchWithDefaultApp = fn;
  return () => { openFileModule.launchWithDefaultApp = original; };
}

async function main() {
  const originalRoots = config.computerOperator.allowedRoots;
  setupFixtures();

  try {
    config.computerOperator.allowedRoots = [TEST_ROOT];

    // === The core safety boundary: extension blocking ===

    for (const ext of BLOCKED_EXTENSIONS) {
      assert.strictEqual(isBlockedExtension(`somefile${ext}`), true, `${ext} should be blocked`);
    }
    console.log(`✓ isBlockedExtension: correctly flags all ${BLOCKED_EXTENSIONS.length} blocked extensions`);

    const safeExtensions = ['.pdf', '.docx', '.txt', '.jpg', '.png', '.mp3', '.mp4', '.csv', '.xlsx'];
    for (const ext of safeExtensions) {
      assert.strictEqual(isBlockedExtension(`somefile${ext}`), false, `${ext} should NOT be blocked`);
    }
    console.log('✓ isBlockedExtension: does not block ordinary safe document/media file types');

    assert.strictEqual(isBlockedExtension('SETUP.EXE'), true, 'extension blocking must be case-insensitive');
    assert.strictEqual(isBlockedExtension('Resume.PDF'), false);
    console.log('✓ isBlockedExtension: case-insensitive, so SETUP.EXE is blocked just like setup.exe');

    // === openFile: the full pipeline, real filesystem, real checks ===

    let launchedWith = null;
    let restore = stubLaunch(async (p) => { launchedWith = p; });
    let result = await openFile(path.join(TEST_ROOT, 'resume.pdf'));
    restore();
    assert.strictEqual(result.status, 'opened');
    assert.strictEqual(launchedWith, path.join(TEST_ROOT, 'resume.pdf'));
    console.log('✓ openFile: a safe file passes all checks and reaches the actual launch step');

    let launchCalled = false;
    restore = stubLaunch(async () => { launchCalled = true; });
    await assert.rejects(() => openFile(path.join(TEST_ROOT, 'setup.exe')), /executables\/scripts/);
    restore();
    assert.strictEqual(launchCalled, false, 'a blocked file must NEVER reach the actual launch step, not even attempted');
    console.log('✓ openFile: a .exe is refused before any launch is attempted - hard block, not a soft warning');

    for (const name of ['script.bat', 'install.ps1', 'macro.vbs']) {
      launchCalled = false;
      restore = stubLaunch(async () => { launchCalled = true; });
      await assert.rejects(() => openFile(path.join(TEST_ROOT, name)), /executables\/scripts/);
      restore();
      assert.strictEqual(launchCalled, false, `${name} must be refused, not launched`);
    }
    console.log('✓ openFile: scripts and installers (.bat, .ps1, .vbs) are all refused the same as .exe');

    launchCalled = false;
    restore = stubLaunch(async () => { launchCalled = true; });
    await assert.rejects(() => openFile(path.join(OUTSIDE_ROOT, 'secret.pdf')), /outside the allowed folders/);
    restore();
    assert.strictEqual(launchCalled, false);
    console.log('✓ openFile: a safe-extension file OUTSIDE the allowlist is still refused - path safety applies regardless of file type');

    await assert.rejects(() => openFile(path.join(TEST_ROOT, 'does-not-exist.pdf')), /does not exist/);
    console.log('✓ openFile: a nonexistent file produces a clear, honest error');

    await assert.rejects(() => openFile(path.join(TEST_ROOT, 'a-real-folder')), /not a file/);
    console.log('✓ openFile: refuses to "open" a directory, points toward listDirectory instead');

    await assert.rejects(() => openFile(path.join(TEST_ROOT, 'evil".pdf')), /double-quote/);
    console.log('✓ openFile: a path containing a double-quote character is refused (shell-injection defense in depth)');

    config.computerOperator.allowedRoots = [];
    await assert.rejects(() => openFile(path.join(TEST_ROOT, 'resume.pdf')), /not configured yet/);
    console.log('✓ openFile: refuses clearly when no folders are configured at all');

    // === computer.openFile plugin action ===

    config.computerOperator.allowedRoots = [TEST_ROOT];
    const openFileAction = require('../plugins/computer/actions/openFile');
    assert.strictEqual(openFileAction.irreversible, false, 'opening a SAFE file type should not require approval, same non-gated spirit as search/list');
    assert.strictEqual(openFileAction.permission, 'computer.read');

    launchedWith = null;
    restore = stubLaunch(async (p) => { launchedWith = p; });
    const actionResult = await openFileAction.run({ filePath: path.join(TEST_ROOT, 'notes.txt') });
    restore();
    assert.strictEqual(actionResult.status, 'opened');
    console.log('✓ plugin action: computer.openFile correctly wraps the core logic, marked non-irreversible (safe types only)');

    // === ComputerOperatorAgent: "open" mode planning ===

    const mockProvider = require('../core/providers/mockProvider');
    function stubProviderSequence(responses) {
      let call = 0;
      const original = mockProvider.complete;
      mockProvider.complete = async () => ({ text: responses[Math.min(call++, responses.length - 1)], provider: 'mock', costEstimate: 0 });
      return () => { mockProvider.complete = original; };
    }

    const ComputerOperatorAgent = require('../agents/computer-operator/ComputerOperatorAgent');
    const agent = new ComputerOperatorAgent();

    // Case 12: an unambiguous "open my resume" plans a real computer.openFile tool_call.
    let restoreExtract = stubProviderSequence(['{"mode": "open", "query": "", "extensions": [], "folderName": "", "fileName": "resume"}']);
    let steps = await agent.plan({ instruction: 'open my resume', history: [] });
    restoreExtract();
    assert.strictEqual(steps[0].type, 'tool_call');
    assert.strictEqual(steps[0].tool, 'computer.openFile');
    assert.strictEqual(steps[0].args.filePath, path.join(TEST_ROOT, 'resume.pdf'));
    console.log('✓ ComputerOperatorAgent: "open my resume" correctly resolves and plans a real computer.openFile call');

    // Case 13: a filename matching nothing plans an honest "not found" message.
    restoreExtract = stubProviderSequence(['{"mode": "open", "query": "", "extensions": [], "folderName": "", "fileName": "nonexistentfile"}']);
    steps = await agent.plan({ instruction: 'open my nonexistentfile', history: [] });
    restoreExtract();
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].type, 'llm_call');
    assert(steps[0].instruction.includes('no file matching'));
    console.log('✓ ComputerOperatorAgent: "open" mode with no matching file plans an honest "not found" message');

    // Case 14: a filename matching MULTIPLE files asks the user to pick from the real candidates.
    fs.writeFileSync(path.join(TEST_ROOT, 'notes-backup.txt'), 'test'); // now "notes" matches both notes.txt and notes-backup.txt
    restoreExtract = stubProviderSequence(['{"mode": "open", "query": "", "extensions": [], "folderName": "", "fileName": "notes"}']);
    steps = await agent.plan({ instruction: 'open my notes file', history: [] });
    restoreExtract();
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].type, 'llm_call');
    assert(steps[0].instruction.includes('notes.txt') && steps[0].instruction.includes('notes-backup.txt'));
    console.log('✓ ComputerOperatorAgent: multiple matching files asks the user to pick from the real candidates, never guesses');

    console.log('\nAll computer-operator Stage 3 (open file) checks passed.');
  } finally {
    config.computerOperator.allowedRoots = originalRoots;
    cleanupFixtures();
  }
}

main().catch((err) => {
  console.error('✗ computer-operator-openfile.test.js failed:', err);
  process.exit(1);
});