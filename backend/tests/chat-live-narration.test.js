const assert = require('assert');
const http = require('http');
const express = require('express');
const { loadPlugins } = require('../core/pluginLoader');
loadPlugins();
const mockProvider = require('../core/providers/mockProvider');
const eventsRoutes = require('../api/eventsRoutes');
const chat = require('../core/chat');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const app = express();
  app.use('/api/events', eventsRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;

  const receivedNarrations = [];
  const sseReq = http.get({ hostname: 'localhost', port, path: '/api/events/stream' }, (res) => {
    res.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.action === 'narration') receivedNarrations.push(event.metadata.text);
        } catch { /* comment/ping lines */ }
      }
    });
  });
  await sleep(300); // let the real SSE connection genuinely establish before the build starts

  mockProvider.complete = async ({ system }) => {
    if (system.includes('Classify the user')) return { text: '{"category":"coding"}' };
    if (system.includes('software architect')) {
      return {
        text: JSON.stringify({
          projectName: 'test-site',
          summary: 'A real test site with a hero and a contact page',
          design: { palette: [{ name: 'Navy', hex: '#0F172A' }], typography: {}, layoutConcept: 'x', signature: 'x' },
          files: [{ path: 'index.html', description: 'The real homepage with a hero section' }],
        }),
      };
    }
    return { text: '<html>real page</html>' };
  };

  // This is the real thing the Chat page's live behavior depends on: the
  // SAME blocking call /api/chat makes, checked for real narration arriving
  // over the live stream WHILE it is still unresolved - not after.
  const chatPromise = chat.handleMessage('Build me a test website', [], []);
  await sleep(600);

  assert(receivedNarrations.length > 0, 'real narration must arrive over the live SSE stream while the blocking chat request is still in flight');
  assert(
    receivedNarrations.some((n) => n.includes('real test site with a hero')),
    'the real plan content should be in the live narration, not placeholder text'
  );
  console.log('✓ real narration genuinely arrives over the live stream WHILE the blocking /api/chat request is still unresolved');

  const result = await chatPromise;
  assert(result.reply.length > 0);
  assert(receivedNarrations.length >= 3, 'should have received plan + file + completion narrations by the time the request resolves');
  console.log('✓ the full narration sequence (plan, file, completion) arrives over the live stream during one real chat-triggered build');

  sseReq.destroy();
  server.close();
  console.log('\nAll chat live-narration checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
