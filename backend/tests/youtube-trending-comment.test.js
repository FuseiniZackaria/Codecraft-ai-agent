const assert = require('assert');

process.env.YOUTUBE_API_KEY = 'test-yt-key';
process.env.COMPOSIO_API_KEY = 'test-composio-key';

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');

function stubFetch(responder) {
  const original = global.fetch;
  global.fetch = responder;
  return () => { global.fetch = original; };
}

async function main() {
  loadPlugins();

  // 1. getTrending - real request shape, genuinely different from search
  // (no query at all, uses chart=mostPopular instead).
  let capturedUrl = null;
  let restore = stubFetch(async (url) => {
    capturedUrl = url.toString();
    return {
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'vid1',
            snippet: { title: 'Trending Now', channelTitle: 'Popular Channel', description: 'D', publishedAt: '2026-08-01T00:00:00Z' },
            statistics: { viewCount: '5000000', likeCount: '200000' },
          },
        ],
      }),
    };
  });
  const result = await toolRegistry.call('youtube.getTrending', {}, { role: 'test' });
  assert(capturedUrl.startsWith('https://www.googleapis.com/youtube/v3/videos'));
  assert(capturedUrl.includes('chart=mostPopular'));
  assert(!capturedUrl.includes('q='), 'trending should never include a search query param');
  assert(capturedUrl.includes('regionCode=US'), 'should default to a US region');
  assert.strictEqual(result.results[0].title, 'Trending Now');
  assert.strictEqual(result.results[0].viewCount, 5000000);
  console.log('✓ getTrending sends the correct real request (chart=mostPopular, no query) and parses results correctly');

  await toolRegistry.call('youtube.getTrending', { regionCode: 'GB' }, { role: 'test' });
  assert(capturedUrl.includes('regionCode=GB'), 'a custom region should be respected');
  restore();
  console.log('✓ getTrending respects a custom regionCode');

  delete process.env.YOUTUBE_API_KEY;
  delete require.cache[require.resolve('../config')];
  delete require.cache[require.resolve('../plugins/youtube/actions/getTrending.js')];
  const freshTrending = require('../plugins/youtube/actions/getTrending.js');
  await assert.rejects(freshTrending.run({}), /YOUTUBE_API_KEY/);
  console.log('✓ getTrending refuses clearly when no key is configured');

  // 2. postComment - correct args/slug threaded through this codebase's own
  // composio.execute() wrapper. Mocking at THIS layer (not the underlying
  // @composio/core SDK) means this test works identically whether the real
  // package or a sandbox stub is installed - it never depends on how the
  // third-party SDK itself is implemented.
  //
  // Note: the exact slug (YOUTUBE_POST_COMMENT_ON_VIDEO) is a
  // best-evidenced guess, not verified against a live Composio account -
  // see the comment in postComment.js itself for the reasoning and what to
  // do if it turns out to be wrong.
  const composio = require('../core/composio');
  const originalExecute = composio.execute;
  let capturedCall = null;
  composio.execute = async (actionSlug, args, toolkitSlug) => {
    capturedCall = { actionSlug, args, toolkitSlug };
    return { id: 'comment123' };
  };

  const commentResult = await toolRegistry.call('youtube.postComment', { videoId: 'abc123', text: 'Great video!' }, { role: 'test' });
  assert.strictEqual(capturedCall.actionSlug, 'YOUTUBE_POST_COMMENT_ON_VIDEO');
  assert.strictEqual(capturedCall.args.videoId, 'abc123');
  assert.strictEqual(capturedCall.args.text, 'Great video!');
  assert.strictEqual(capturedCall.toolkitSlug, 'youtube');
  assert.strictEqual(commentResult.status, 'commented');
  console.log('✓ postComment correctly threads videoId/text to Composio with the expected slug');

  await assert.rejects(toolRegistry.call('youtube.postComment', { videoId: 'abc123' }, { role: 'test' }), /"videoId" and "text"/);
  console.log('✓ postComment validates both required arguments');

  composio.execute = originalExecute;

  console.log('\nAll YouTube trending/comment checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
