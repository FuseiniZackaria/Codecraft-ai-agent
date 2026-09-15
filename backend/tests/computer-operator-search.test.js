const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const { isPathAllowed, assertPathAllowed, isExcludedDirName, getAllowedRoots } = require('../core/computerOperator/pathSafety');
const { searchFiles } = require('../core/computerOperator/fileSearch');

// Built dynamically under the OS's own temp directory - works identically
// on Windows, macOS, and Linux, unlike a hardcoded /tmp path.
const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-operator-test-'));
const TEST_ROOT = path.join(SANDBOX_ROOT, 'allowed-root');
const OUTSIDE_ROOT = path.join(SANDBOX_ROOT, 'not-allowed');
const DOWNLOADS_ROOT = path.join(SANDBOX_ROOT, 'Downloads');
function setupFixtures() {
  fs.mkdirSync(path.join(TEST_ROOT, 'subdir'), { recursive: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'node_modules'), { recursive: true });
  fs.mkdirSync(OUTSIDE_ROOT, { recursive: true });
  // Stage 2 fixture: a folder literally named "Downloads" as an allowed
  // root's own basename, plus a differently-named subfolder inside another
  // root, to test both resolution paths in findDirectoriesByName.
  fs.mkdirSync(DOWNLOADS_ROOT, { recursive: true });
  fs.writeFileSync(path.join(DOWNLOADS_ROOT, 'installer.exe'), 'test');
  fs.writeFileSync(path.join(DOWNLOADS_ROOT, 'photo.jpg'), 'test');
  fs.mkdirSync(path.join(TEST_ROOT, 'MyProjectFolder'), { recursive: true });

  fs.writeFileSync(path.join(TEST_ROOT, 'invoice-march.pdf'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'invoice-april.txt'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'subdir', 'invoice-deep.pdf'), 'test');
  fs.writeFileSync(path.join(TEST_ROOT, 'node_modules', 'invoice-should-be-excluded.pdf'), 'test');
  fs.writeFileSync(path.join(OUTSIDE_ROOT, 'invoice-secret.pdf'), 'test');
}

function cleanupFixtures() {
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
}

async function main() {
  const originalRoots = config.computerOperator.allowedRoots;
  setupFixtures();

  try {
    // === pathSafety.js: default-deny ===

    config.computerOperator.allowedRoots = [];
    assert.strictEqual(isPathAllowed(TEST_ROOT), false, 'with an empty allowlist, NOTHING should be accessible - default deny');
    assert.throws(() => assertPathAllowed(TEST_ROOT), /not configured yet/);
    console.log('✓ pathSafety: with no allowed roots configured, everything is denied by default (fail closed)');

    // === pathSafety.js: allowlist enforcement ===

    config.computerOperator.allowedRoots = [TEST_ROOT];
    assert.strictEqual(isPathAllowed(TEST_ROOT), true, 'the allowed root itself must be allowed');
    assert.strictEqual(isPathAllowed(path.join(TEST_ROOT, 'subdir')), true, 'a subfolder of an allowed root must be allowed');
    assert.strictEqual(isPathAllowed(OUTSIDE_ROOT), false, 'a folder outside the allowlist must be denied');
    console.log('✓ pathSafety: correctly allows the configured root and its subfolders, denies everything else');

    // Regression-style check: a sibling folder that merely SHARES A PREFIX
    // with an allowed root must NOT be treated as allowed (naive
    // startsWith() would wrongly match "allowed-root2" against "allowed-root").
    const trickyPath = TEST_ROOT + '-evil-sibling';
    assert.strictEqual(isPathAllowed(trickyPath), false, 'a path that merely shares a string prefix with an allowed root must not be allowed - this must be a real path boundary, not a substring match');
    console.log('✓ pathSafety: a sibling folder sharing a text prefix with an allowed root is correctly NOT treated as allowed (real path-boundary check, not substring match)');

    assert.throws(() => assertPathAllowed(OUTSIDE_ROOT), /outside the allowed folders/);
    console.log('✓ pathSafety: assertPathAllowed throws a clear error for a disallowed path');

    assert.strictEqual(isExcludedDirName('node_modules'), true);
    assert.strictEqual(isExcludedDirName('my-documents'), false);
    console.log('✓ pathSafety: correctly identifies default-excluded directory names');

    // === fileSearch.js ===

    config.computerOperator.allowedRoots = [TEST_ROOT];

    // Case 1: basic substring match across nested folders.
    let result = searchFiles({ query: 'invoice' });
    const foundNames = result.results.map((r) => r.name).sort();
    assert(foundNames.includes('invoice-march.pdf'), 'should find invoice-march.pdf');
    assert(foundNames.includes('invoice-april.txt'), 'should find invoice-april.txt');
    assert(foundNames.includes('invoice-deep.pdf'), 'should find invoice-deep.pdf in a nested subfolder');
    console.log('✓ searchFiles: finds matching files recursively, including in nested subfolders');

    // Case 2: excluded directories (node_modules) are never descended into, even inside an allowed root.
    assert(!foundNames.includes('invoice-should-be-excluded.pdf'), 'files inside node_modules must never appear, even though the parent folder is allowed');
    console.log('✓ searchFiles: never descends into excluded directories (node_modules) even inside an allowed root');

    // Case 3: extension filter.
    result = searchFiles({ query: 'invoice', extensions: ['pdf'] });
    const pdfNames = result.results.map((r) => r.name);
    assert(pdfNames.includes('invoice-march.pdf'));
    assert(!pdfNames.includes('invoice-april.txt'), 'extension filter should exclude non-matching file types');
    console.log('✓ searchFiles: extension filter correctly restricts results to the requested file type(s)');

    // Case 4: a query that matches nothing returns an empty, well-formed result, not an error.
    result = searchFiles({ query: 'this-definitely-does-not-exist-anywhere' });
    assert.deepStrictEqual(result.results, []);
    assert.strictEqual(result.truncated, false);
    console.log('✓ searchFiles: a query with no matches returns a clean empty result, not an error');

    // Case 5: an empty query throws a clear validation error.
    assert.throws(() => searchFiles({ query: '' }), /non-empty "query"/);
    console.log('✓ searchFiles: an empty query is rejected with a clear error');

    // Case 6: maxResults is genuinely enforced (truncation flag set correctly).
    result = searchFiles({ query: 'invoice', maxResults: 2 });
    assert.strictEqual(result.results.length, 2, 'should stop exactly at maxResults');
    assert.strictEqual(result.truncated, true, 'truncated flag must be set when more results existed than the cap allowed');
    console.log('✓ searchFiles: maxResults is enforced and the truncated flag is set correctly');

    // Case 7: explicitly passing a root OUTSIDE the allowlist is refused, not silently searched.
    result = searchFiles({ query: 'invoice-secret', roots: [OUTSIDE_ROOT] });
    assert.deepStrictEqual(result.results, [], 'a root outside the allowlist must never actually be searched, even if explicitly requested');
    assert(result.skippedFolders.some((s) => s.includes('outside allowed roots')), 'should record why the folder was skipped');
    console.log('✓ searchFiles: a search root outside the allowlist is refused and recorded, never silently searched');

    // === computer.searchFiles plugin action ===

    const { loadPlugins } = require('../core/pluginLoader');
    const toolRegistry = require('../tools/ToolRegistry');
    loadPlugins();

    assert(toolRegistry.tools.get('computer.searchFiles'), 'computer.searchFiles should be registered as a real tool');
    const toolResult = await toolRegistry.call('computer.searchFiles', { query: 'invoice' }, { role: 'test' });
    assert(toolResult.results.length > 0, 'the plugin action should return real results through the actual tool registry, not just the internal function');
    console.log('✓ plugin: computer.searchFiles is correctly registered and callable through the real tool registry');

    // Plugin action refuses cleanly when nothing is configured.
    config.computerOperator.allowedRoots = [];
    await assert.rejects(
      () => toolRegistry.call('computer.searchFiles', { query: 'invoice' }, { role: 'test' }),
      /No folders are configured/
    );
    console.log('✓ plugin: computer.searchFiles refuses clearly when no folders are configured, instead of silently doing nothing');

    // === ComputerOperatorAgent ===

    config.computerOperator.allowedRoots = [TEST_ROOT];
    const mockProvider = require('../core/providers/mockProvider');
    const aiProvider = require('../core/providers/aiProvider');
    const ComputerOperatorAgent = require('../agents/computer-operator/ComputerOperatorAgent');
    const agent = new ComputerOperatorAgent();

    function stubProviderSequence(responses) {
      let call = 0;
      const respond = async () => ({ text: responses[Math.min(call++, responses.length - 1)], provider: 'mock', costEstimate: 0 });
      const originalMock = mockProvider.complete;
      const originalAi = aiProvider.complete;
      mockProvider.complete = respond;
      aiProvider.complete = respond;
      return () => { mockProvider.complete = originalMock; aiProvider.complete = originalAi; };
    }

    let restore = stubProviderSequence(['{"query": "invoice", "extensions": []}', 'Found 3 invoice files: invoice-march.pdf, invoice-april.txt, invoice-deep.pdf.']);
    let steps = await agent.plan({ instruction: 'find my invoice files' });
    assert.strictEqual(steps.length, 2, 'a successful extraction should plan a tool_call followed by a summarizing llm_call');
    assert.strictEqual(steps[0].type, 'tool_call');
    assert.strictEqual(steps[0].tool, 'computer.searchFiles');
    assert.strictEqual(steps[0].args.query, 'invoice');
    restore();
    console.log('✓ ComputerOperatorAgent: plans a real search tool_call with the correctly extracted query');

    // No allowed roots at all - plan should short-circuit to a clarifying message, never attempt the search.
    config.computerOperator.allowedRoots = [];
    steps = await agent.plan({ instruction: 'find my invoice files' });
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].type, 'llm_call');
    assert(steps[0].instruction.includes('COMPUTER_ALLOWED_ROOTS'));
    console.log('✓ ComputerOperatorAgent: with no allowed roots configured, plans a clear explanatory message instead of attempting a doomed search');
    config.computerOperator.allowedRoots = [TEST_ROOT];

    // Extraction failure (unparseable) - plan should ask for clarification, not crash or search blindly.
    restore = stubProviderSequence(['not valid json']);
    steps = await agent.plan({ instruction: 'blah blah unclear' });
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].type, 'llm_call');
    restore();
        console.log('✓ ComputerOperatorAgent: an unparseable extraction falls back to asking the user to clarify, never guesses');

    // === Stage 2: directoryInspect.js ===

    config.computerOperator.allowedRoots = [TEST_ROOT, DOWNLOADS_ROOT];
    const { listDirectory, findDirectoriesByName } = require('../core/computerOperator/directoryInspect');

    // Case 1: listDirectory returns immediate children only, files and folders both.
    let listing = listDirectory(TEST_ROOT);
    const listedNames = listing.entries.map((e) => e.name).sort();
    assert(listedNames.includes('invoice-march.pdf'), 'should list a file directly in the folder');
    assert(listedNames.includes('subdir'), 'should list a subfolder directly in the folder');
    assert(listedNames.includes('MyProjectFolder'));
    console.log('✓ listDirectory: lists immediate files and subfolders of a specific folder');

    // Case 2: NOT recursive - contents of a subfolder must not appear at the top level.
    assert(!listedNames.includes('invoice-deep.pdf'), 'listDirectory must only list ONE level deep, not recurse into subfolders');
    console.log('✓ listDirectory: does not recurse - only lists one level deep');

    // Case 3: excluded folders (node_modules) still don't show up.
    assert(!listedNames.includes('node_modules'), 'excluded folder names must not appear even in a direct listing');
    console.log('✓ listDirectory: excluded folder names are hidden from the listing too');

    // Case 4: directories get null size, files get a real byte size.
    const subdirEntry = listing.entries.find((e) => e.name === 'subdir');
    const fileEntry = listing.entries.find((e) => e.name === 'invoice-march.pdf');
    assert.strictEqual(subdirEntry.sizeBytes, null);
    assert.strictEqual(typeof fileEntry.sizeBytes, 'number');
    console.log('✓ listDirectory: correctly distinguishes files (real size) from directories (null size)');

    // Case 5: a folder outside the allowlist is refused.
    assert.throws(() => listDirectory(OUTSIDE_ROOT), /outside the allowed folders/);
    console.log('✓ listDirectory: refuses to list a folder outside the allowlist');

    // Case 6: findDirectoriesByName resolves an allowed root's OWN name directly (the common "downloads" case).
    let found = findDirectoriesByName('Downloads');
    assert.deepStrictEqual(found, [DOWNLOADS_ROOT]);
    console.log('✓ findDirectoriesByName: resolves a folder name that IS an allowed root itself');

    // Case 7: findDirectoriesByName finds a subfolder by name within an allowed root.
    found = findDirectoriesByName('MyProjectFolder');
    assert.deepStrictEqual(found, [path.join(TEST_ROOT, 'MyProjectFolder')]);
    console.log('✓ findDirectoriesByName: finds a real subfolder within an allowed root by name');

    // Case 8: no match found returns an empty array, never a guessed/invented path.
    found = findDirectoriesByName('this-folder-definitely-does-not-exist');
    assert.deepStrictEqual(found, []);
    console.log('✓ findDirectoriesByName: returns an empty array (never invents a path) when nothing matches');

    // === computer.listDirectory plugin action ===

    const toolResult2 = await toolRegistry.call('computer.listDirectory', { dirPath: TEST_ROOT }, { role: 'test' });
    assert(toolResult2.entries.length > 0, 'listDirectory plugin action should return real entries through the actual tool registry');
    console.log('✓ plugin: computer.listDirectory is correctly registered and callable through the real tool registry');

    // === ComputerOperatorAgent: list mode + the exact real-world history-context bug ===

    config.computerOperator.allowedRoots = [TEST_ROOT, DOWNLOADS_ROOT];

    // Case 9: a direct, unambiguous "what's in my downloads" plans a real listDirectory call.
    let restoreList = stubProviderSequence(['{"mode": "list", "query": "", "extensions": [], "folderName": "downloads"}']);
    let listSteps = await agent.plan({ instruction: "what's in my downloads", history: [] });
    restoreList();
    assert.strictEqual(listSteps[0].type, 'tool_call');
    assert.strictEqual(listSteps[0].tool, 'computer.listDirectory');
    assert.strictEqual(listSteps[0].args.dirPath, DOWNLOADS_ROOT);
    console.log('✓ ComputerOperatorAgent: "what\'s in my downloads" correctly plans a real directory listing');

    // Case 10: THE ACTUAL REPORTED BUG - "yes full list" alone is meaningless, but combined
    // with the previous turn's history, must resolve to listing the downloads folder.
    const conversationHistory = [
      { role: 'user', content: 'what are in my computer downloads' },
      { role: 'assistant', content: 'I wasn\'t able to determine a specific filename or keyword... Do you want a full listing of everything in your Downloads folder?' },
    ];
    restoreList = stubProviderSequence(['{"mode": "list", "query": "", "extensions": [], "folderName": "downloads"}']);
    listSteps = await agent.plan({ instruction: 'yes full list', history: conversationHistory });
    restoreList();
    assert.strictEqual(listSteps[0].type, 'tool_call', 'REGRESSION: "yes full list" must resolve using conversation history, not ask again from scratch');
    assert.strictEqual(listSteps[0].tool, 'computer.listDirectory');
    assert.strictEqual(listSteps[0].args.dirPath, DOWNLOADS_ROOT);
    console.log('✓ ComputerOperatorAgent: REGRESSION FIXED - "yes full list" now correctly resolves using conversation history from the previous turn');

    // Case 11: a folder name matching nothing plans an honest "not found" message, never a fake path.
    restoreList = stubProviderSequence(['{"mode": "list", "query": "", "extensions": [], "folderName": "nonexistentfolder"}']);
    listSteps = await agent.plan({ instruction: 'show me my nonexistentfolder', history: [] });
    restoreList();
    assert.strictEqual(listSteps.length, 1);
    assert.strictEqual(listSteps[0].type, 'llm_call');
    assert(listSteps[0].instruction.includes('no folder matching'));
    console.log('✓ ComputerOperatorAgent: a folder name matching nothing plans an honest "not found" message');

    // Case 12: an ambiguous name matching MULTIPLE folders asks the user to pick, listing the real candidates.
    config.computerOperator.allowedRoots = [TEST_ROOT]; // both "subdir" and "MyProjectFolder" exist here; craft a name matching both
    fs.mkdirSync(path.join(TEST_ROOT, 'ProjectA'), { recursive: true });
    fs.mkdirSync(path.join(TEST_ROOT, 'ProjectB'), { recursive: true });
    restoreList = stubProviderSequence(['{"mode": "list", "query": "", "extensions": [], "folderName": "project"}']);
    listSteps = await agent.plan({ instruction: 'show me my project folder', history: [] });
    restoreList();
    assert.strictEqual(listSteps.length, 1);
    assert.strictEqual(listSteps[0].type, 'llm_call');
    assert(listSteps[0].instruction.includes('ProjectA') && listSteps[0].instruction.includes('ProjectB'), 'should list the REAL candidate folders found, not pick one silently');
    console.log('✓ ComputerOperatorAgent: multiple matching folders asks the user to pick from the real candidates, never guesses');

    console.log('\nAll computer-operator Stage 1+2 (filesystem search + directory inspection) checks passed.');
  } finally {
    config.computerOperator.allowedRoots = originalRoots;
    cleanupFixtures();
  }
}

main().catch((err) => {
  console.error('✗ computer-operator-search.test.js failed:', err);
  process.exit(1);
});