const https = require('https');
const config = require('../../../config');

/**
 * websearch.search - real web search via Tavily (https://tavily.com), built
 * specifically for LLM agents: returns clean text results instead of raw HTML.
 * Requires TAVILY_API_KEY in .env. Throws a clear error if not configured,
 * so callers (agents) can decide how to degrade gracefully.
 */
module.exports = {
  name: 'search',
  permission: 'websearch.search',
  irreversible: false,

  async run({ query, maxResults = 5 }) {
    if (!config.search.tavilyKey) {
      throw new Error('TAVILY_API_KEY not configured - web search unavailable');
    }
    if (!query) throw new Error('search requires a "query"');

    const body = JSON.stringify({
      api_key: config.search.tavilyKey,
      query,
      max_results: maxResults,
      include_answer: true,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.tavily.com',
          path: '/search',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode >= 400) {
                return reject(new Error(`Tavily API error: ${parsed?.detail || res.statusCode}`));
              }
              resolve({
                answer: parsed.answer || null,
                results: (parsed.results || []).map((r) => ({
                  title: r.title,
                  url: r.url,
                  content: r.content,
                })),
              });
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  },
};
