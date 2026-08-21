const config = require('../../../config');

const DEFAULT_MAX_RESULTS = 10;
const MAX_ALLOWED_RESULTS = 25;

module.exports = {
  name: 'getTrending',
  permission: 'youtube',
  irreversible: false,

  /**
   * YouTube's own curated "trending" feed - genuinely different from
   * search: no query at all, just chart=mostPopular for a given region.
   * Costs only 1 quota unit (vs 100 for search.list), so this is cheap to
   * call often.
   */
  async run({ regionCode = 'US', categoryId, maxResults = DEFAULT_MAX_RESULTS }) {
    if (!config.search.youtubeKey) {
      throw new Error('YouTube search not configured - set YOUTUBE_API_KEY in .env');
    }

    const capped = Math.min(Number(maxResults) || DEFAULT_MAX_RESULTS, MAX_ALLOWED_RESULTS);

    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('key', config.search.youtubeKey);
    url.searchParams.set('part', 'snippet,statistics');
    url.searchParams.set('chart', 'mostPopular');
    url.searchParams.set('regionCode', regionCode);
    url.searchParams.set('maxResults', String(capped));
    if (categoryId) url.searchParams.set('videoCategoryId', categoryId);

    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || `YouTube API error (HTTP ${res.status})`);
    }

    const results = (json.items || []).map((item) => ({
      videoId: item.id,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      description: item.snippet.description,
      publishedAt: item.snippet.publishedAt,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
      likeCount: item.statistics?.likeCount ? Number(item.statistics.likeCount) : null,
    }));

    return { results, regionCode };
  },
};
