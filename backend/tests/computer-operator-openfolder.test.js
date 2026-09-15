const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const { openFolder } = require('../core/computerOperator/openFolder');

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-operator-openfolder-test-'));
const TEST_ROOT = path.join(SANDBOX_ROOT, 'allowed-root');
const OUTSIDE_ROOT = path.join(SANDBOX_ROOT, 'not-allowed');

function setupFixtures() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  fs.mkdirSync(OUTSIDE_ROOT, { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'Downloads'), { recursive: true });
  fs.writeFileSync(path.join(TEST_ROOT, 'resume.pdf'), 'test');
}

function cleanupFixtures() {
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
}

function stubLaunch(fn) {
  const openFolderModule = require('../core/computerOperator/openFolder');
  const original = openFolderModule.launchWithDefaultApp;
  openFolderModule.launchWithDefaultApp = fn;
  return () => { openFolderModule.launchWithDefaultApp = original; };
}

async function main() {
  const originalRoots = config.computerOperator.allowedRoots;
  setupFixtures();

  try {
    config.computerOperator.allowedRoots = [TEST_ROOT];

    let launchedWith = null;
    let restore = stubLaunch(async (p) => { launchedWith = p; });
    let result = await openFolder(path.join(TEST_ROOT, 'Downloads'));
    restore();
    assert.strictEqual(result.status, 'opened');
    assert.strictEqual(launchedWith, path.join(TEST_ROOT, 'Downloads'));
    console.log('✓ openFolder: a real folder passes all checks and reaches the actual launch step');

    launchedWith = null;
    restore = stubLaunch(async (p) => { launchedWith = p; });
    result = await openFolder(TEST_ROOT);
    restore();
    assert.strictEqual(result.status, 'opened');
    console.log('✓ openFolder: the allowed root itself can be opened, not just subfolders');

    let launchCalled = false;
    restore = stubLaunch(async () => { launchCalled = true; });
    await assert.rejects(() => openFolder(OUTSIDE_ROOT), /outside the allowed folders/);
    restore();
    assert.strictEqual(launchCalled, false);
    console.log('✓ openFolder: a folder outside the allowlist is refused, launch never attempted');

    await assert.rejects(() => openFolder(path.join(TEST_ROOT, 'resume.pdf')), /not a folder/);
    console.log('✓ openFolder: refuses to "open" a file as if it were a folder, points toward openFile instead');

    await assert.rejects(() => openFolder(path.join(TEST_ROOT, 'does-not-exist')), /does not exist/);
    console.log('✓ openFolder: a nonexistent folder produces a clear, honest error (not a generic "permission issue")');

    await assert.rejects(() => openFolder(path.join(TEST_ROOT, 'evil"folder')), /double-quote/);
    console.log('✓ openFolder: a path containing a double-quote is refused (shell-injection defense in depth)');

    config.computerOperator.allowedRoots = [];
    await assert.rejects(() => openFolder(TEST_ROOT), /not configured yet/);
    console.log('✓ openFolder: refuses clearly when no folders are configured at all');

    config.computerOperator.allowedRoots = [TEST_ROOT];
    const openFolderAction = require('../plugins/computer/actions/openFolder');
    assert.strictEqual(openFolderAction.irreversible, false);
    assert.strictEqual(openFolderAction.permission, 'computer.read');

    launchedWith = null;
    restore = stubLaunch(async (p) => { launchedWith = p; });
    const actionResult = await openFolderAction.run({ dirPath: path.join(TEST_ROOT, 'Downloads') });
    restore();
    assert.strictEqual(actionResult.status, 'opened');
    console.log('✓ plugin action: computer.openFolder correctly wraps the core logic');

    // === ComputerOperatorAgent: "openFolder" mode planning ===

    const mockProvider = require('../core/providers/mockProvider');
    function stubProviderSequence(responses) {
      let call = 0;
      const original = mockProvider.complete;
      mockProvider.complete = async () => ({ text: responses[Math.min(call++, responses.length - 1)], provider: 'mock', costEstimate: 0 });
      return () => { mockProvider.complete = original; };
    }

    const ComputerOperatorAgent = require('../agents/computer-operator/ComputerOperatorAgent');
    const agent = new ComputerOperatorAgent();

    // Case 9: "open my downloads folder" plans a real computer.openFolder call, NOT a text listing.
    let restoreExtract = stubProviderSequence(['{"mode": "openFolder", "query": "", "extensions": [], "folderName": "downloads", "fileName": ""}']);
    let steps = await agent.plan({ instruction: 'open my downloads folder', history: [] });
    restoreExtract();
    assert.strictEqual(steps[0].type, 'tool_call');
    assert.strictEqual(steps[0].tool, 'computer.openFolder');
    assert.strictEqual(steps[0].args.dirPath, path.join(TEST_ROOT, 'Downloads'));
    console.log('✓ ComputerOperatorAgent: "open my downloads folder" plans a real Explorer launch, not a text listing');

    // Case 10: distinct from "what's in my downloads" which should still plan listDirectory (Stage 2 behavior unaffected).
    restoreExtract = stubProviderSequence(['{"mode": "list", "query": "", "extensions": [], "folderName": "downloads", "fileName": ""}']);
    steps = await agent.plan({ instruction: "what's in my downloads", history: [] });
    restoreExtract();
    assert.strictEqual(steps[0].tool, 'computer.listDirectory', 'a "what\'s in X" request must still list contents in chat, not launch Explorer - these are genuinely different actions');
    console.log('✓ ComputerOperatorAgent: "what\'s in my downloads" still plans a text listing, correctly distinct from "open my downloads folder"');

    // Case 11: a folder name matching nothing in openFolder mode plans an honest "not found" message.
    restoreExtract = stubProviderSequence(['{"mode": "openFolder", "query": "", "extensions": [], "folderName": "nonexistentfolder", "fileName": ""}']);
    steps = await agent.plan({ instruction: 'open my nonexistentfolder', history: [] });
    restoreExtract();
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].type, 'llm_call');
    assert(steps[0].instruction.includes('no folder matching'));
    console.log('✓ ComputerOperatorAgent: "openFolder" mode with no matching folder plans an honest "not found" message');

    console.log('\nAll computer-operator Stage 4 (open folder) checks passed.');
  } finally {
    config.computerOperator.allowedRoots = originalRoots;
    cleanupFixtures();
  }
}

main().catch((err) => {
  console.error('✗ computer-operator-openfolder.test.js failed:', err);
  process.exit(1);
});