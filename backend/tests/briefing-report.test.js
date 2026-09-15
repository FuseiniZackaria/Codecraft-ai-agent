const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuid } = require('uuid');

const { buildBriefingReport, parseBriefBody } = require('../core/briefing/reportBuilder');
const BriefingAgent = require('../agents/briefing/BriefingAgent');
const memory = require('../memory');

const TEST_OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-report-test-'));

async function main() {
  // === REGRESSION GUARD: the synthesis step's token budget. ===
  // This exact value was silently reverted from 2800 back to 1500 multiple
  // times across separate full-file rewrites of BriefingAgent.js, each time
  // quietly reintroducing a real truncation bug on multi-topic briefs.
  // Reading the source file directly (rather than triggering a real LLM
  // call) makes this catchable by `node tests/briefing-report.test.js`
  // alone, with no API key needed.
  const agentSource = fs.readFileSync(path.join(__dirname, '..', 'agents', 'briefing', 'BriefingAgent.js'), 'utf8');
  // Simpler and more robust than trying to precisely target one specific
  // step via text proximity: the synthesis step is deliberately the one
  // that needs the LARGEST token budget of any step in this file (every
  // other step - clarifying questions, short confirmations - genuinely
  // needs far less). So the maximum maxTokens value found anywhere is
  // exactly the synthesis step's, without fragile matching.
  const allMaxTokens = [...agentSource.matchAll(/maxTokens:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert(allMaxTokens.length > 0, 'could not find any maxTokens values in BriefingAgent.js - has the file structure changed unexpectedly?');
  const largestMaxTokens = Math.max(...allMaxTokens);
  assert(largestMaxTokens >= 2800, `REGRESSION: the largest maxTokens value in BriefingAgent.js is only ${largestMaxTokens}, but the synthesis step must be >= 2800 - multi-topic briefs (2+ topics x 5 results) genuinely need this much room and will silently truncate otherwise. Do not lower this without a real reason.`);
  console.log(`✓ REGRESSION GUARD: BriefingAgent's synthesis step maxTokens is ${largestMaxTokens} (>= 2800, as required)`);

  const agent = new BriefingAgent();

  const searchResult = {
    answer: 'some answer text',
    results: [
      { title: 'Reuters: Healthcare bill passes', url: 'https://reuters.com/a', content: '...' },
      { title: null, url: 'https://apnews.com/b', content: '...' },
      { title: 'Reuters: Healthcare bill passes', url: 'https://reuters.com/a', content: 'duplicate of above' },
    ],
  };
  let sources = agent.extractSources([searchResult]);
  assert.strictEqual(sources.length, 2, 'duplicate URLs must be deduplicated, even across multiple result entries');
  assert.strictEqual(sources[0].title, 'Reuters: Healthcare bill passes');
  assert.strictEqual(sources[1].title, 'https://apnews.com/b', 'a missing title should fall back to the URL itself, never blank');
  console.log('✓ extractSources: correctly extracts and deduplicates {title, url} pairs from websearch.search results');

  const pageResult = { url: 'https://example.com/article', title: 'Example Article', text: 'page content...' };
  sources = agent.extractSources([pageResult]);
  assert.deepStrictEqual(sources, [{ title: 'Example Article', url: 'https://example.com/article' }]);
  console.log('✓ extractSources: correctly extracts a {title, url} pair from a browser.readPage-shaped result');

  const llmResult = { provider: 'mock', text: 'the final synthesized brief text', costEstimate: 0 };
  const noOpResult = { deferred: true, text: 'Deferred for approval' };
  sources = agent.extractSources([searchResult, pageResult, llmResult, noOpResult]);
  assert.strictEqual(sources.length, 3, 'should combine sources across multiple steps, and never mistake the final text-only result for a source');
  console.log('✓ extractSources: correctly combines sources across multiple mixed step results, ignoring non-source shapes (like the final llm_call text)');

  sources = agent.extractSources([{ text: 'no sources here' }, null, undefined]);
  assert.deepStrictEqual(sources, []);
  console.log('✓ extractSources: returns a clean empty array when no real sources are present, never throws');

  const formatted = '**Topic One**: First point about topic one.\n\nSecond paragraph, no heading.\n\n**Topic Two**: Point about topic two.';
  const parsed = parseBriefBody(formatted);
  assert(parsed.length >= 4, 'a 3-block input with 2 headed sections should produce at least 4 paragraphs (heading+body pairs plus the plain block)');
  console.log('✓ parseBriefBody: correctly splits headed and plain blocks into separate paragraphs');

  const plainOnly = parseBriefBody('Just one plain paragraph with no special formatting at all.');
  assert.strictEqual(plainOnly.length, 1, 'plain text with no heading convention should safely fall back to a single body paragraph');
  console.log('✓ parseBriefBody: plain text with no heading markers safely falls back to ordinary body paragraphs');

  const reportPath = await buildBriefingReport({
    goal: 'Test brief on a topic',
    briefText: '**Section**: Some content here with a citation from Example News.',
    sources: [{ title: 'Example News', url: 'https://example.com/news' }],
    outputDir: TEST_OUTPUT_DIR,
  });
  assert(fs.existsSync(reportPath), 'the report file must actually exist on disk after generation');
  assert(reportPath.endsWith('.docx'));
  assert(fs.statSync(reportPath).size > 1000, 'a real docx file should be well over 1KB, not an empty/corrupt stub');
  console.log('✓ buildBriefingReport: a real .docx file is created on disk at the returned path');

  const messyGoal = 'Brief: "politics" & the economy!! (Ghana/2026)';
  const messyPath = await buildBriefingReport({ goal: messyGoal, briefText: 'content', sources: [], outputDir: TEST_OUTPUT_DIR });
  assert(fs.existsSync(messyPath));
  assert(!/[":&!()\/]/.test(path.basename(messyPath)), 'unsafe filename characters must be stripped from the generated filename');
  console.log('✓ buildBriefingReport: unsafe characters in the goal text are stripped from the generated filename');

  const fakeTask = {
    id: uuid(),
    agent: 'briefing',
    instruction: 'Integration test brief goal',
    status: 'pending',
    irreversible: false,
    toolCall: null,
    payload: null,
    created_at: new Date().toISOString(),
  };
  await memory.saveTask(fakeTask);

  const fakeResults = [searchResult, { provider: 'mock', text: 'Final synthesized brief for integration test.', costEstimate: 0 }];
  await agent.reflect(fakeTask, fakeResults);

  const finalResult = fakeResults[fakeResults.length - 1];
  assert(finalResult.text.includes('Final synthesized brief for integration test.'), 'the original brief text must still be present, not replaced');
  assert(finalResult.text.includes('.docx'), 'the final result text should now mention the generated report path');
  const mentionedPath = finalResult.text.match(/saved to: (.+\.docx)/)?.[1];
  assert(mentionedPath && fs.existsSync(mentionedPath), 'the file path mentioned in the reply must correspond to a real file that actually exists');
  console.log('✓ BriefingAgent.reflect(): the full flow works end-to-end - a real report file is built and its path is appended to the chat reply');

  const savedRun = await memory.getLatestBriefingRun('Integration test brief goal');
  assert(savedRun, 'the run should still be saved for future comparison, same as before this change');
  assert.strictEqual(savedRun.output, 'Final synthesized brief for integration test.', 'the SAVED run output must be the original brief text, not the mutated text with the file path appended');
  console.log('✓ BriefingAgent.reflect(): memory.saveBriefingRun still saves the ORIGINAL brief text (not the file-path-appended version), so future comparisons stay clean');

  fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });

  console.log('\nAll briefing-report checks passed.');
}

main().catch((err) => {
  console.error('✗ briefing-report.test.js failed:', err);
  process.exitCode = 1;
});