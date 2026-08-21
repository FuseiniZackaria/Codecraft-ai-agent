const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
loadPlugins();
const memory = require('../memory');
const eventBus = require('../core/eventBus');
const mockProvider = require('../core/providers/mockProvider');
const CodingAgent = require('../agents/coding/CodingAgent');

async function run() {
  const narrations = [];
  const onEvent = (e) => {
    if (e.action === 'narration' && e.taskId === 'narration-test-task') narrations.push(e.metadata.text);
  };
  eventBus.on('event', onEvent);

  mockProvider.complete = async ({ system }) => {
    if (system.includes('software architect')) {
      return {
        text: JSON.stringify({
          projectName: 'felix-agidipo-ministries',
          summary: 'A modern ministry website with hero, sermons, events, and gallery sections',
          design: {
            palette: [{ name: 'Navy', hex: '#0F172A' }, { name: 'Gold', hex: '#D4AF37' }, { name: 'Cream', hex: '#FAF7F0' }],
            typography: { display: 'Playfair Display', body: 'Inter' },
            layoutConcept: 'Full-bleed hero with editorial grid below',
            signature: 'A gold underline that draws itself under the headline on load',
          },
          files: [
            { path: 'index.html', description: 'Homepage - hero with Rev. Agidipo, ministry intro, upcoming events, latest sermons' },
            { path: 'styles.css', description: 'Navy/gold/cream design system with the signature gold underline animation' },
          ],
        }),
      };
    }
    return { text: '<html>real content</html>' };
  };

  const agent = new CodingAgent();
  const task = { id: 'narration-test-task', instruction: 'Build a ministry website for Rev. Felix Agidipo' };
  await memory.saveTask(task);
  await agent.run(task);
  eventBus.off('event', onEvent);

  assert.strictEqual(narrations.length, 4, 'should narrate: plan, each of the 2 files, and completion');
  assert(narrations[0].includes('modern ministry website'), 'the real plan summary should genuinely appear in the first narration, not generic filler');
  assert(narrations[0].includes('Navy/Gold/Cream'), 'the real chosen design palette should genuinely appear');
  assert(narrations.some((n) => n.includes('hero with Rev. Agidipo')), 'the real per-file description from the plan should appear in its narration line');
  assert(narrations[narrations.length - 1].includes('Done'), 'a clear completion narration should fire, not silence after the last file');
  console.log('✓ the Coding Agent narrates real plan/design/file content through the live event bus, not generic filler');

  // Confirm these are genuinely LIVE events (pushed through the same bus
  // Console.jsx already streams from), not something only persisted after
  // the fact - the SSE route just re-broadcasts whatever the bus emits.
  assert(narrations.every((n) => typeof n === 'string' && n.length > 10), 'every narration should be real, substantive text');
  console.log('✓ narration events are pushed through the existing live event bus, reusable by any live-streaming client');

  console.log('\nAll Coding Agent narration checks passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
