const assert = require('assert');
const fs = require('fs');
const path = require('path');

const config = require('../config');
const mockProvider = require('../core/providers/mockProvider');
const aiProvider = require('../core/providers/aiProvider');

const BUSINESS_JSON_PATH = path.join(__dirname, '..', 'config', 'business.json');

function stubProvider(text) {
  const respond = async () => ({ text, provider: 'mock', costEstimate: 0 });
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = respond;
  aiProvider.complete = respond;
  return () => {
    mockProvider.complete = originalMock;
    aiProvider.complete = originalAi;
  };
}

function stubProviderSequence(responsesWithFlags) {
  let call = 0;
  const respond = async () => {
    const item = responsesWithFlags[Math.min(call, responsesWithFlags.length - 1)];
    call++;
    return { text: item.text, provider: 'mock', costEstimate: 0, truncated: !!item.truncated };
  };
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = respond;
  aiProvider.complete = respond;
  return () => {
    mockProvider.complete = originalMock;
    aiProvider.complete = originalAi;
  };
}

async function main() {
  const { updateBusinessProfileFromMessage } = require('../core/businessProfileUpdater');
  const { classifyIntent } = require('../core/intentClassifier');

  // Back up the REAL file and in-memory config so this test never leaves
  // permanent test data behind, regardless of how it exits.
  const originalFileContent = fs.readFileSync(BUSINESS_JSON_PATH, 'utf-8');
  const originalBusiness = { ...config.business };

  try {
    // === classifyIntent routing ===

    let restoreProvider = stubProvider('{"category": "business_profile"}');
    let { category, isActionable } = await classifyIntent('Our hours are Monday to Friday 9am to 6pm');
    restoreProvider();
    assert.strictEqual(category, 'business_profile');
    console.log('✓ classifyIntent: a statement of business hours routes to business_profile');

    // Keyword fallback path (simulating LLM classification being unavailable).
    const originalMock = mockProvider.complete;
    const originalAi = aiProvider.complete;
    mockProvider.complete = async () => { throw new Error('simulated outage'); };
    aiProvider.complete = async () => { throw new Error('simulated outage'); };
    const fallbackResult = await classifyIntent('our hours are 9-5 every day');
    mockProvider.complete = originalMock;
    aiProvider.complete = originalAi;
    assert.strictEqual(fallbackResult.category, 'business_profile', 'keyword fallback should also catch an obvious business-hours statement');
    console.log('✓ classifyIntent: keyword fallback also routes an obvious business-info statement to business_profile');

    // Regression test for a real bug: "if someone asks X, send them Y" was
    // being misclassified as email_send (matched on the word "send"),
    // creating a pointless approval task instead of saving the fact.
    mockProvider.complete = async () => { throw new Error('simulated outage'); };
    aiProvider.complete = async () => { throw new Error('simulated outage'); };
    const websiteResult = await classifyIntent('if someone asks for our website send them this link "https://codecraft-wheat.vercel.app/"');
    mockProvider.complete = originalMock;
    aiProvider.complete = originalAi;
    assert.strictEqual(websiteResult.category, 'business_profile', '"if someone asks X, send them Y" must route to business_profile, not email_send');
    console.log('✓ classifyIntent: "if someone asks for our website, send them this link" correctly routes to business_profile, not email_send');

    // === updateBusinessProfileFromMessage ===

    // Start from a clean, minimal profile for deterministic assertions.
    Object.keys(config.business).forEach((k) => delete config.business[k]);
    Object.assign(config.business, {
      companyName: 'Acme Cafe', industry: '', targetMarket: '', description: '',
      knownCompetitors: [], hours: '', location: '', services: '', pricing: '',
      policies: '', faq: [],
    });

    // Case 1: a real update only changes the field(s) actually mentioned.
    restoreProvider = stubProvider(JSON.stringify({
      companyName: 'Acme Cafe', industry: '', targetMarket: '', description: '',
      knownCompetitors: [], hours: 'Mon-Fri 9am-6pm', location: '', services: '', pricing: '',
      policies: '', faq: [],
    }));
    let result = await updateBusinessProfileFromMessage('Our hours are Monday to Friday 9am to 6pm');
    restoreProvider();

    assert.deepStrictEqual(result.changedFields, ['hours']);
    assert.strictEqual(config.business.hours, 'Mon-Fri 9am-6pm');
    assert.strictEqual(config.business.companyName, 'Acme Cafe', 'unrelated existing fields must not be touched');
    console.log('✓ updateBusinessProfileFromMessage: only updates the field(s) the message actually provided, leaves the rest untouched');

    // Confirm it was actually written to disk, not just in memory.
    const onDisk = JSON.parse(fs.readFileSync(BUSINESS_JSON_PATH, 'utf-8'));
    assert.strictEqual(onDisk.hours, 'Mon-Fri 9am-6pm');
    console.log('✓ updateBusinessProfileFromMessage: persists the update to business.json on disk, not just in memory');

    // Case 2: a message with no real new info reports zero changed fields.
    restoreProvider = stubProvider(JSON.stringify({ ...config.business }));
    result = await updateBusinessProfileFromMessage('just saying hi');
    restoreProvider();
    assert.strictEqual(result.changedFields.length, 0);
    console.log('✓ updateBusinessProfileFromMessage: a message with no real business info reports zero changed fields');

    // Case 3: the model can NEVER introduce a new top-level key not already in the schema.
    restoreProvider = stubProvider(JSON.stringify({ ...config.business, hackerField: 'should never appear' }));
    result = await updateBusinessProfileFromMessage('irrelevant');
    restoreProvider();
    assert(!('hackerField' in config.business), 'a field not in the original schema must never be added');
    assert(!('hackerField' in result.updated));
    console.log('✓ updateBusinessProfileFromMessage: sanitizes against the existing schema - cannot introduce new top-level fields');

    // Case 4: an unparseable model response throws a clear error, doesn't silently corrupt the file.
    restoreProvider = stubProvider('not valid json at all');
    const beforeBadUpdate = fs.readFileSync(BUSINESS_JSON_PATH, 'utf-8');
    await assert.rejects(() => updateBusinessProfileFromMessage('something'), /could not parse|did not return a valid/);
    const afterBadUpdate = fs.readFileSync(BUSINESS_JSON_PATH, 'utf-8');
    restoreProvider();
    assert.strictEqual(beforeBadUpdate, afterBadUpdate, 'a failed parse must never touch the file on disk');
    console.log('✓ updateBusinessProfileFromMessage: an unparseable response throws clearly and never corrupts the file');

    // Case 5: a truncated response (result.truncated=true, invalid/cut-off JSON) is
    // automatically retried with a larger token budget instead of failing outright -
    // this is exactly the real bug a large FAQ update triggered.
    const fullProfile = { ...config.business, faq: [{ question: 'Do you deliver?', answer: 'Yes, within 10 miles.' }] };
    let restoreSeq = stubProviderSequence([
      { text: '{"companyName": "Acme Cafe", "faq": [{"question": "Do you del', truncated: true }, // cut off mid-response
      { text: JSON.stringify(fullProfile), truncated: false }, // succeeds on retry with more room
    ]);
    result = await updateBusinessProfileFromMessage('Add a FAQ: do you deliver? yes, within 10 miles.');
    restoreSeq();
    assert.deepStrictEqual(config.business.faq, fullProfile.faq);
    console.log('✓ updateBusinessProfileFromMessage: a truncated response is automatically retried with a larger token budget instead of failing');

    // Case 6: if EVERY retry attempt is truncated, it fails with a clear, actionable message
    // rather than a raw JSON parse error.
    restoreSeq = stubProviderSequence([
      { text: '{"companyName": "cut off', truncated: true },
      { text: '{"companyName": "still cut off', truncated: true },
      { text: '{"companyName": "still cut off again', truncated: true },
    ]);
    await assert.rejects(
      () => updateBusinessProfileFromMessage('a very long update'),
      /could not parse the updated business profile after \d+ attempts/
    );
    restoreSeq();
    console.log('✓ updateBusinessProfileFromMessage: if every retry is still truncated, fails with a clear, actionable error message');

    console.log('\nAll business profile chat update checks passed.');
  } finally {
    // Restore both the real file and in-memory config, regardless of outcome.
    fs.writeFileSync(BUSINESS_JSON_PATH, originalFileContent);
    Object.keys(config.business).forEach((k) => delete config.business[k]);
    Object.assign(config.business, originalBusiness);
  }
}

main().catch((err) => {
  console.error('✗ business-profile-chat.test.js failed:', err);
  process.exit(1);
});
