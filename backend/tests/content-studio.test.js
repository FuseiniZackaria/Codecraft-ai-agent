const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const { classify } = require('../core/orchestrator/planner');
const orchestrator = require('../core/orchestrator');
const mockProvider = require('../core/providers/mockProvider');

function stubProvider(responses) {
  let call = 0;
  const original = mockProvider.complete;
  mockProvider.complete = async () => {
    const text = responses[Math.min(call, responses.length - 1)];
    call++;
    return { text, provider: 'mock', costEstimate: 0 };
  };
  return () => { mockProvider.complete = original; };
}

async function main() {
  const plugins = loadPlugins();
  assert(plugins.includes('websearch'), 'websearch plugin should load');

  const c1 = classify('Promote my new restaurant');
  const c2 = classify('Create a campaign for my web design business');
  assert(c1.isContentStudio && c2.isContentStudio, 'spec example phrasings should route to Content Studio');
  console.log('✓ both spec example phrasings route to Content Studio Agent');

  const c3 = classify('Write a marketing email announcing our new feature');
  assert(!c3.isContentStudio && c3.isMarketing, 'ordinary marketing email request should stay with Marketing Agent');
  console.log('✓ does not collide with Marketing Agent for ordinary marketing requests');

  const restore = stubProvider([
    '{"category": "content_studio"}',
    'search results text',
    'Keywords: cozy, family-owned\nHooks: "Ever had a Tuesday that tasted like Sunday?"\nPain points: nowhere good nearby\nBenefits: fresh, fast, affordable\nCTAs: book a table tonight',
    'Target audience: young families within 5 miles\nBrand messaging: home-cooked, fast\nFunnel: Instagram ad -> reservation link\nSchedule: 3 posts/week',
    'TikTok script: "POV: your Tuesday just got better"\nYouTube Shorts script: kitchen tour\nLonger video script: chef interview',
    'Instagram: Tuesday just got a glow up ✨ Book now!\nLinkedIn: Proud to serve our neighborhood\nTikTok: POV ur hungry rn\nX: New menu just dropped',
    '#Instagram: #familyrestaurant #localfood\n#TikTok: #foodtok #hungry\n#LinkedIn: #smallbusiness #localeats',
  ]);

  let task;
  try {
    const [result] = await orchestrator.submitGoal('Promote my new restaurant');
    task = result;
  } finally {
    restore();
  }

  assert.strictEqual(task.status, 'done', `content studio task should complete, got: ${JSON.stringify(task.result)}`);
  assert.strictEqual(task.agent, 'content-studio');
  console.log('✓ content studio task completes end to end via the real orchestrator');

  const finalDoc = task.result[task.result.length - 1].text;
  for (const heading of ['## Research', '## Campaign Strategy', '## Video Scripts', '## Captions', '## Hashtags']) {
    assert(finalDoc.includes(heading), `final document should include "${heading}"`);
  }
  console.log('✓ final combined document includes all 5 sections: research, strategy, scripts, captions, hashtags');

  console.log('\nAll content studio integration checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
