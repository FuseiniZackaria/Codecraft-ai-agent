const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * dashboardStats.js - turns raw briefing_articles rows into the political
 * intelligence dashboard's numbers. A pure function deliberately - no
 * database access here, so this is fully unit-testable without a live
 * Supabase connection, and the route handler stays a thin wrapper.
 *
 * Definitions (confirmed with the user, not silently invented):
 *   - "Breaking / important news" = articles collected in the last 24h.
 *   - "Trending topics" direction = this week's count vs last week's count
 *     for that topic. >20% up = up, >20% down = down, else flat. A topic
 *     with zero last week and any activity this week counts as up (new).
 *   - "Issues gaining attention" = count of topics currently flagged "up".
 *   - "Discussions monitored" is deliberately NOT computed here - nothing
 *     in this system collects social/forum discussion data yet, and
 *     fabricating a number for it would be a fake metric with nothing real
 *     behind it.
 *
 * @param {Array<{topic, collectedAt, title, url, sourceDomain, summary}>} articles - rows from the last 14+ days
 * @returns {object} the dashboard's computed stats
 */
function computeDashboardStats(articles) {
  const now = Date.now();

  const ageMs = (a) => now - new Date(a.collectedAt).getTime();
  const last24h = articles.filter((a) => ageMs(a) < DAY_MS);
  const last7Days = articles.filter((a) => ageMs(a) < 7 * DAY_MS);
  const prior7Days = articles.filter((a) => {
    const age = ageMs(a);
    return age >= 7 * DAY_MS && age < 14 * DAY_MS;
  });

  function countByTopic(list) {
    const counts = new Map();
    for (const a of list) {
      if (!a.topic) continue;
      counts.set(a.topic, (counts.get(a.topic) || 0) + 1);
    }
    return counts;
  }

  const thisWeekByTopic = countByTopic(last7Days);
  const lastWeekByTopic = countByTopic(prior7Days);
  const allTopics = new Set([...thisWeekByTopic.keys(), ...lastWeekByTopic.keys()]);

  const trendingTopics = Array.from(allTopics)
    .map((topic) => {
      const thisWeekCount = thisWeekByTopic.get(topic) || 0;
      const lastWeekCount = lastWeekByTopic.get(topic) || 0;
      let direction = 'flat';
      if (lastWeekCount === 0 && thisWeekCount > 0) direction = 'up';
      else if (thisWeekCount > lastWeekCount * 1.2) direction = 'up';
      else if (thisWeekCount < lastWeekCount * 0.8) direction = 'down';
      return { topic, thisWeekCount, lastWeekCount, direction };
    })
    .sort((a, b) => b.thisWeekCount - a.thisWeekCount);

  const issuesGainingAttention = trendingTopics.filter((t) => t.direction === 'up').length;

  const dailyMentions = {};
  for (const a of last7Days) {
    const day = new Date(a.collectedAt).toISOString().slice(0, 10);
    dailyMentions[day] = (dailyMentions[day] || 0) + 1;
  }

  const latestNews = [...articles]
    .sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt))
    .slice(0, 10)
    .map((a) => ({
      title: a.title,
      url: a.url,
      sourceDomain: a.sourceDomain,
      summary: a.summary,
      topic: a.topic,
      collectedAt: a.collectedAt,
    }));

  return {
    breakingNewsCount: last24h.length,
    trendingIssuesCount: trendingTopics.length,
    articlesCollectedCount: articles.length,
    issuesGainingAttentionCount: issuesGainingAttention,
    trendingTopics,
    latestNews,
    dailyMentions,
  };
}

module.exports = { computeDashboardStats };