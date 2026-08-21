const assert = require('assert');

process.env.YOUTUBE_API_KEY = 'test-yt-key';

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const orchestrator = require('../core/orchestrator');
const mockProvider = require('../core/providers/mockProvider');

function stubFetch(responder) {
  const original = global.fetch;
  global.fetch = responder;
  return () => { global.fetch = original; };
}

async function main() {
  loadPlugins();

  const capturedUrls = [];
  let restore = stubFetch(async (url) => {
    capturedUrls.push(url.toString());
    if (url.toString().includes('/search')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: { videoId: 'abc123' }, snippet: { title: 'How to bake bread', channelTitle: 'Baking Channel', description: 'A tutorial', publishedAt: '2026-01-01T00:00:00Z' } },
            { id: { videoId: 'def456' }, snippet: { title: 'Sourdough tips', channelTitle: 'Bread Masters', description: 'Tips', publishedAt: '2026-02-01T00:00:00Z' } },
          ],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        items: [
          { id: 'abc123', statistics: { viewCount: '15000', likeCount: '500' } },
          { id: 'def456', statistics: { viewCount: '8000', likeCount: '200' } },
        ],
      }),
    };
  });

  const result = await toolRegistry.call('youtube.search', { query: 'bread baking tips' }, { role: 'test' });
  assert(capturedUrls[0].startsWith('https://www.googleapis.com/youtube/v3/search'));
  assert(capturedUrls[0].includes('key=test-yt-key'));
  assert(capturedUrls[0].includes('q=bread+baking+tips'), 'query should be correctly URL-encoded');
  assert(capturedUrls[1].startsWith('https://www.googleapis.com/youtube/v3/videos'));
  assert(capturedUrls[1].includes('abc123') && capturedUrls[1].includes('def456'));
  assert.strictEqual(result.results.length, 2);
  assert.strictEqual(result.results[0].title, 'How to bake bread');
  assert.strictEqual(result.results[0].viewCount, 15000, 'view count should be merged in from the stats follow-up call');
  assert.strictEqual(result.results[0].url, 'https://www.youtube.com/watch?v=abc123');
  restore();
  console.log('✓ youtube.search sends the correct real API requests and merges view counts from the follow-up call');

  let cappedValue = null;
  restore = stubFetch(async (url) => {
    const parsed = new URL(url.toString());
    if (parsed.pathname.includes('/search')) {
      cappedValue = parsed.searchParams.get('maxResults');
      return { ok: true, json: async () => ({ items: [] }) };
    }
  });
  await toolRegistry.call('youtube.search', { query: 'x', maxResults: 1000 }, { role: 'test' });
  assert.strictEqual(cappedValue, '10', 'maxResults must be capped, not passed through unbounded');
  restore();
  console.log('✓ maxResults is capped at a sane maximum regardless of what the caller requests');

  restore = stubFetch(async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API key not valid' } }) }));
  await assert.rejects(toolRegistry.call('youtube.search', { query: 'x' }, { role: 'test' }), /API key not valid/);
  restore();
  console.log('✓ a real API error surfaces clearly, not a generic failure');

  restore = stubFetch(async (url) => {
    if (url.toString().includes('/search')) {
      return { ok: true, json: async () => ({ items: [{ id: { videoId: 'xyz' }, snippet: { title: 'Test', channelTitle: 'C', description: 'D', publishedAt: '2026-01-01' } }] }) };
    }
    throw new Error('network failure on stats call');
  });
  const result4 = await toolRegistry.call('youtube.search', { query: 'x' }, { role: 'test' });
  assert.strictEqual(result4.results.length, 1, 'search results should still return despite the stats call failing');
  assert.strictEqual(result4.results[0].viewCount, null, 'viewCount should gracefully be null, not crash the whole call');
  restore();
  console.log('✓ a failed stats follow-up degrades gracefully instead of breaking the whole search');

  delete process.env.YOUTUBE_API_KEY;
  delete require.cache[require.resolve('../config')];
  delete require.cache[require.resolve('../plugins/youtube/actions/search.js')];
  const freshAction = require('../plugins/youtube/actions/search.js');
  await assert.rejects(freshAction.run({ query: 'x' }), /YOUTUBE_API_KEY/);
  console.log('✓ youtube.search refuses clearly when no key is configured');

  process.env.YOUTUBE_API_KEY = 'test-yt-key';
  delete require.cache[require.resolve('../config')];

  restore = stubFetch(async (url) => {
    if (url.toString().includes('/search')) {
      return { ok: true, json: async () => ({ items: [{ id: { videoId: 'trend1' }, snippet: { title: 'This exact trending video title', channelTitle: 'C', description: 'D', publishedAt: '2026-01-01' } }] }) };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  });
  let capturedResearchPrompt = null;
  const originalComplete = mockProvider.complete;
  mockProvider.complete = async ({ prompt }) => {
    if ((prompt || '').includes('Research this like')) capturedResearchPrompt = prompt;
    return { text: 'Some generated content', provider: 'mock', costEstimate: 0 };
  };

  const [task] = await orchestrator.submitGoal('Create a campaign for my bakery');
  mockProvider.complete = originalComplete;
  restore();

  assert.strictEqual(task.status, 'done');
  assert(capturedResearchPrompt && capturedResearchPrompt.includes('This exact trending video title'), 'YouTube search results must actually reach the research step as context');
  console.log('✓ Content Studio includes the youtube.search step when configured, and its results genuinely reach the research step');

  console.log('\nAll YouTube search checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
