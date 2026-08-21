const config = require('../../../config');

// search.list costs 100 quota units against YouTube's default 10,000/day
// allowance - capping results keeps a single call from being wasteful, and
// keeps this usable for many searches per day rather than ~10-20 broad ones.
const DEFAULT_MAX_RESULTS = 5;
const MAX_ALLOWED_RESULTS = 10;

module.exports = {
  name: 'search',
  permission: 'youtube',
  irreversible: false,

  async run({ query, maxResults = DEFAULT_MAX_RESULTS }) {
    if (!config.search.youtubeKey) {
      throw new Error('YouTube search not configured - set YOUTUBE_API_KEY in .env');
    }
    if (!query) throw new Error('search requires "query"');

    const capped = Math.min(Number(maxResults) || DEFAULT_MAX_RESULTS, MAX_ALLOWED_RESULTS);

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('key', config.search.youtubeKey);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', String(capped));

    const searchRes = await fetch(searchUrl);
    const searchJson = await searchRes.json();
    if (!searchRes.ok) {
      throw new Error(searchJson?.error?.message || `YouTube API error (HTTP ${searchRes.status})`);
    }

    const items = searchJson.items || [];
    const videoIds = items.map((i) => i.id?.videoId).filter(Boolean);
    if (!videoIds.length) return { results: [] };

    // search.list doesn't include view/like counts - a separate videos.list
    // call is required to get statistics. If this second call fails for any
    // reason, still return the search results themselves rather than
    // failing the whole tool over a nice-to-have.
    let statsById = {};
    try {
      const statsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      statsUrl.searchParams.set('key', config.search.youtubeKey);
      statsUrl.searchParams.set('part', 'statistics');
      statsUrl.searchParams.set('id', videoIds.join(','));
      const statsRes = await fetch(statsUrl);
      const statsJson = await statsRes.json();
      if (statsRes.ok) {
        for (const v of statsJson.items || []) statsById[v.id] = v.statistics;
      }
    } catch {
      // stats are a nice-to-have - fall through with whatever search already returned
    }

    const results = items
      .filter((item) => item.id?.videoId)
      .map((item) => {
        const stats = statsById[item.id.videoId];
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          description: item.snippet.description,
          publishedAt: item.snippet.publishedAt,
          url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
          viewCount: stats?.viewCount ? Number(stats.viewCount) : null,
          likeCount: stats?.likeCount ? Number(stats.likeCount) : null,
        };
      });

    return { results };
  },
};
