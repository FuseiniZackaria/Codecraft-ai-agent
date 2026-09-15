const assert = require('assert');
const { v4: uuid } = require('uuid');

const BriefingAgent = require('../agents/briefing/BriefingAgent');
const memory = require('../memory');

async function main() {
  const agent = new BriefingAgent();

  const economySearch = {
    answer: 'economy answer',
    results: [
      { title: 'GDP grows 6%', url: 'https://example.com/gdp', content: 'A'.repeat(600) },
      { title: 'Inflation falls', url: 'https://example.com/inflation', content: 'short content' },
    ],
  };
  const politicsSearch = {
    answer: 'politics answer',
    results: [
      { title: 'Election update', url: 'https://example.com/election', content: 'election details' },
    ],
  };
  const finalText = { provider: 'mock', text: 'final brief', costEstimate: 0 };

  const task1 = { instruction: 'Daily brief on economy and politics', extractedTopics: ['economy', 'politics'] };
  const results1 = [economySearch, politicsSearch, finalText];

  let articles = agent.extractArticles(task1, results1);
  assert.strictEqual(articles.length, 3, 'should extract one article per real result, across both topic searches');
  assert.strictEqual(articles.find((a) => a.url === 'https://example.com/gdp').topic, 'economy', 'articles from the first search step should be tagged with the first topic');
  assert.strictEqual(articles.find((a) => a.url === 'https://example.com/election').topic, 'politics', 'articles from the second search step should be tagged with the second topic');
  console.log('✓ extractArticles: correctly tags each article with its originating topic via step-index alignment');

  const longArticle = articles.find((a) => a.url === 'https://example.com/gdp');
  assert.strictEqual(longArticle.summary.length, 500, 'a long content snippet should be truncated to 500 chars for storage');
  assert.strictEqual(longArticle.sourceDomain, 'example.com', 'sourceDomain should be correctly extracted from the URL');
  console.log('✓ extractArticles: truncates long summaries to 500 chars and correctly extracts sourceDomain');

  const wwwResult = { results: [{ title: 'Test', url: 'https://www.reuters.com/article', content: 'x' }] };
  articles = agent.extractArticles({ instruction: 'goal', extractedTopics: ['topic'] }, [wwwResult]);
  assert.strictEqual(articles[0].sourceDomain, 'reuters.com', 'a leading www. should be stripped from the extracted domain');
  console.log('✓ extractArticles: strips a leading "www." from the extracted source domain');

  const pageResult = { url: 'https://example.com/page', title: 'A page', text: 'page content' };
  articles = agent.extractArticles({ instruction: 'goal', extractedTopics: ['economy'] }, [pageResult]);
  assert.strictEqual(articles[0].topic, null, 'a browser.readPage result is not tied to a topic search and must be tagged null, not misattributed');
  console.log('✓ extractArticles: browser.readPage results are correctly tagged with topic=null, never misattributed to a search topic');

  const dupSearch = {
    results: [
      { title: 'Same article', url: 'https://example.com/dup', content: 'first' },
      { title: 'Same article again', url: 'https://example.com/dup', content: 'second, should be ignored' },
    ],
  };
  articles = agent.extractArticles({ instruction: 'goal', extractedTopics: ['t'] }, [dupSearch]);
  assert.strictEqual(articles.length, 1, 'the same URL appearing twice within one run should only produce one article record');
  console.log('✓ extractArticles: deduplicates the same URL within a single run');

  articles = agent.extractArticles({ instruction: 'goal' }, [economySearch]);
  assert.strictEqual(articles[0].topic, null, 'with no extractedTopics stashed at all, articles should get topic=null rather than throwing');
  console.log('✓ extractArticles: handles a task with no extractedTopics stashed at all, without throwing');

  const badUrlResult = { results: [{ title: 'Bad', url: 'not-a-real-url', content: 'x' }] };
  articles = agent.extractArticles({ instruction: 'goal', extractedTopics: [] }, [badUrlResult]);
  assert.strictEqual(articles[0].sourceDomain, null, 'an unparseable URL should yield sourceDomain=null rather than throwing');
  console.log('✓ extractArticles: an unparseable URL safely yields sourceDomain=null instead of crashing');

  const fakeTask = {
    id: uuid(),
    agent: 'briefing',
    instruction: 'Integration test dashboard goal',
    extractedTopics: ['economy'],
    status: 'pending',
    irreversible: false,
    toolCall: null,
    payload: null,
    created_at: new Date().toISOString(),
  };
  await memory.saveTask(fakeTask);

  const fakeResults = [economySearch, { provider: 'mock', text: 'Final brief for dashboard integration test.', costEstimate: 0 }];
  await agent.reflect(fakeTask, fakeResults);

  const persisted = await memory.getBriefingArticles('Integration test dashboard goal');
  assert.strictEqual(persisted.length, 2, 'reflect() should have persisted both articles from the economy search via memory.saveBriefingArticles');
  assert(persisted.every((a) => a.topic === 'economy'), 'both persisted articles should be correctly tagged with the economy topic');
  console.log('✓ BriefingAgent.reflect(): real end-to-end flow persists collected articles for the dashboard via memory.saveBriefingArticles');

  console.log('\nAll briefing-dashboard-articles checks passed.');
}

main().catch((err) => {
  console.error('✗ briefing-dashboard-articles.test.js failed:', err);
  process.exitCode = 1;
});