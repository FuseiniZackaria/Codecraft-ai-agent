const assert = require('assert');
const { computeDashboardStats } = require('../core/briefing/dashboardStats');

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

function daysAgo(n) {
  return new Date(now - n * DAY_MS).toISOString();
}

function article({ topic, daysOld, title = 'Title', url = 'https://example.com/a' + Math.random() }) {
  return { topic, collectedAt: daysAgo(daysOld), title, url, sourceDomain: 'example.com', summary: 'summary' };
}

function main() {
  const articles1 = [
    article({ topic: 'economy', daysOld: 0.5 }),
    article({ topic: 'economy', daysOld: 2 }),
  ];
  let stats = computeDashboardStats(articles1);
  assert.strictEqual(stats.breakingNewsCount, 1, 'only the article within the last 24h should count as breaking news');
  console.log('✓ computeDashboardStats: breakingNewsCount only counts articles from the last 24 hours');

  const articles2 = [article({ topic: 'youth employment', daysOld: 2 })];
  stats = computeDashboardStats(articles2);
  const yeTopic = stats.trendingTopics.find((t) => t.topic === 'youth employment');
  assert.strictEqual(yeTopic.direction, 'up', 'a topic with zero prior-week activity and some this week should be flagged up (new)');
  console.log('✓ computeDashboardStats: a brand new topic (zero last week) is correctly flagged "up"');

  const articles3 = [
    ...Array(10).fill(null).map(() => article({ topic: 'economy', daysOld: 2 })),
    ...Array(5).fill(null).map(() => article({ topic: 'economy', daysOld: 10 })),
    ...Array(10).fill(null).map(() => article({ topic: 'stable-topic', daysOld: 2 })),
    ...Array(10).fill(null).map(() => article({ topic: 'stable-topic', daysOld: 10 })),
    ...Array(3).fill(null).map(() => article({ topic: 'fading-topic', daysOld: 2 })),
    ...Array(10).fill(null).map(() => article({ topic: 'fading-topic', daysOld: 10 })),
  ];
  stats = computeDashboardStats(articles3);
  assert.strictEqual(stats.trendingTopics.find((t) => t.topic === 'economy').direction, 'up');
  assert.strictEqual(stats.trendingTopics.find((t) => t.topic === 'stable-topic').direction, 'flat');
  assert.strictEqual(stats.trendingTopics.find((t) => t.topic === 'fading-topic').direction, 'down');
  console.log('✓ computeDashboardStats: correctly classifies up/flat/down based on >20% week-over-week change in either direction');

  const upCount = stats.trendingTopics.filter((t) => t.direction === 'up').length;
  assert.strictEqual(stats.issuesGainingAttentionCount, upCount);
  console.log('✓ computeDashboardStats: issuesGainingAttentionCount exactly matches the number of topics flagged up');

  const articles5 = [article({ topic: 'ancient-topic', daysOld: 20 })];
  stats = computeDashboardStats(articles5);
  assert.strictEqual(stats.trendingTopics.length, 0, 'an article older than 14 days should not appear in either week bucket, so its topic should not appear in trendingTopics at all');
  console.log('✓ computeDashboardStats: articles older than 14 days are correctly excluded from trend calculations');

  const articles6 = [article({ topic: 'a', daysOld: 1 }), article({ topic: 'a', daysOld: 13 })];
  stats = computeDashboardStats(articles6);
  assert.strictEqual(stats.articlesCollectedCount, 2, 'articlesCollectedCount should count everything passed in, not just recent-window articles');
  console.log('✓ computeDashboardStats: articlesCollectedCount reflects the full dataset passed in');

  const articles7 = [article({ topic: null, daysOld: 1 }), article({ topic: 'real-topic', daysOld: 1 })];
  stats = computeDashboardStats(articles7);
  assert.strictEqual(stats.articlesCollectedCount, 2);
  assert.strictEqual(stats.trendingTopics.length, 1, 'a null-topic article should never create a phantom trending-topic entry');
  console.log('✓ computeDashboardStats: null-topic articles count toward the total but never pollute trendingTopics');

  const articles8 = Array(15).fill(null).map((_, i) => article({ topic: 'x', daysOld: i, title: `Article ${i}` }));
  const shuffled = [...articles8].sort(() => Math.random() - 0.5);
  stats = computeDashboardStats(shuffled);
  assert.strictEqual(stats.latestNews.length, 10, 'latestNews should be capped at 10 items');
  assert.strictEqual(stats.latestNews[0].title, 'Article 0', 'the newest article (daysOld=0) should be first regardless of input order');
  for (let i = 1; i < stats.latestNews.length; i++) {
    assert(new Date(stats.latestNews[i - 1].collectedAt) >= new Date(stats.latestNews[i].collectedAt), 'latestNews must be sorted strictly newest-first');
  }
  console.log('✓ computeDashboardStats: latestNews is correctly sorted newest-first and capped at 10, regardless of input order');

  const articles9 = [article({ topic: 'a', daysOld: 1 }), article({ topic: 'a', daysOld: 1 }), article({ topic: 'a', daysOld: 10 })];
  stats = computeDashboardStats(articles9);
  const totalDailyMentions = Object.values(stats.dailyMentions).reduce((s, n) => s + n, 0);
  assert.strictEqual(totalDailyMentions, 2, 'dailyMentions should only include the 2 articles from within the last 7 days, not the 10-day-old one');
  console.log('✓ computeDashboardStats: dailyMentions only covers the last 7 days');

  stats = computeDashboardStats([]);
  assert.strictEqual(stats.breakingNewsCount, 0);
  assert.strictEqual(stats.articlesCollectedCount, 0);
  assert.strictEqual(stats.trendingTopics.length, 0);
  assert.strictEqual(stats.latestNews.length, 0);
  console.log('✓ computeDashboardStats: an empty article list produces safe, zeroed output without throwing');

  assert.strictEqual('discussionsMonitored' in stats, false, 'the output must never include a fabricated discussions-monitored number - nothing collects that data yet');
  console.log('✓ computeDashboardStats: never includes a fabricated "discussions monitored" number');

  console.log('\nAll dashboard-stats checks passed.');
}

main();