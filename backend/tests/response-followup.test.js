const assert = require('assert');

process.env.TAVILY_API_KEY = 'test-tavily-key-p3';

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const mockProvider = require('../core/providers/mockProvider');
const aiProvider = require('../core/providers/aiProvider');
const memory = require('../memory');

// Patches BOTH providers, not just mockProvider. core/router.js's
// selectProvider() picks the real 'ai' provider over 'mock' whenever a real
// API key is configured (higher capability score wins) - so a stub that
// only touches mockProvider silently does nothing in any environment with
// real credentials set, and the test ends up hitting a real, non-deterministic
// LLM call instead of the fixture. Patching both makes the test's outcome
// identical regardless of what's configured in this environment.
function stubProvider(responses) {
  let call = 0;
  const respond = async () => {
    const text = Array.isArray(responses) ? responses[Math.min(call, responses.length - 1)] : responses;
    call++;
    return { text, provider: 'mock', costEstimate: 0 };
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

function stubWebSearch(resultsFn) {
  const original = toolRegistry.tools.get('websearch.search');
  toolRegistry.register('websearch.search', { permission: 'websearch.search', irreversible: false, run: resultsFn });
  return () => { if (original) toolRegistry.register('websearch.search', original); };
}

function stubGmailSend(fn) {
  const original = toolRegistry.tools.get('gmail.sendEmail');
  toolRegistry.register('gmail.sendEmail', { permission: 'gmail.send', irreversible: true, run: fn });
  return () => { if (original) toolRegistry.register('gmail.sendEmail', original); };
}

function stubReadInbox(fn) {
  const original = toolRegistry.tools.get('gmail.readInbox');
  toolRegistry.register('gmail.readInbox', { permission: 'gmail.read', irreversible: false, run: fn });
  return () => { if (original) toolRegistry.register('gmail.readInbox', original); };
}

async function sendOneOpportunity(outreachPipeline, id) {
  // Unique per call/run - critical when testing against a real, persistent
  // database (not an in-memory store that resets every run). Reusing a
  // fixed email like "hiring@acmecorp.com" across runs means old leftover
  // 'sent' pipelines from previous test executions stick around and can
  // get matched instead of the one this specific run just created. A
  // random unique local-part guarantees this run's data can never collide
  // with anything left over from any prior run, without needing to clean
  // up the real database at all.
  const contactEmail = `hiring+${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@acmecorp.com`;

  const opportunity = {
    id,
    company: 'Acme Corp',
    companyWebsite: 'https://www.acmecorp.com',
    jobTitle: 'Senior Backend Engineer',
    jobDescription: 'Backend engineer skilled in Node.js and distributed systems.',
    applicationUrl: 'https://www.acmecorp.com/careers/senior-backend-engineer',
    postedDate: new Date().toISOString(),
    source: 'company careers page',
    contactEmail,
  };

  const restoreSearch = stubWebSearch(async () => ({
    answer: null,
    results: [{ title: 'Acme Corp Careers', url: 'https://www.acmecorp.com/careers', content: 'We are hiring' }],
  }));
  const restoreProvider = stubProvider(['14', '{"subject": "Re: role", "body": "Hi there, reaching out about the role."}']);
  let sentPayload = null;
  const restoreSend = stubGmailSend(async (args) => { sentPayload = args; return { status: 'sent' }; });

  const config = require('../config');
  config.outreach.automaticEnabled = true;
  const record = await outreachPipeline.processOpportunity(opportunity, { mode: outreachPipeline.MODES.AUTOMATIC });
  config.outreach.automaticEnabled = false;

  restoreSearch();
  restoreProvider();
  restoreSend();

  return { record, sentPayload, contactEmail };
}

async function main() {
  loadPlugins();

  const outreachPipeline = require('../core/outreachPipeline');
  const ResponseDetectionAgent = require('../agents/response-detection/ResponseDetectionAgent');
  const responseAgent = new ResponseDetectionAgent();

  // === Response detection ===

  // Case 1: no sent outreach at all - detectResponses should be a clean no-op.
  let result = await responseAgent.detectResponses();
  assert.strictEqual(result.matched, 0);
  console.log('✓ detectResponses: no-op when there is no sent outreach to match against');

  // Case 2: a genuine positive reply from a tracked contact is matched and classified.
  const { record: sentRecord1, contactEmail: email1 } = await sendOneOpportunity(outreachPipeline, 'p3-positive');
  assert.strictEqual(sentRecord1.stage, outreachPipeline.STAGES.SENT, `expected SENT, got ${sentRecord1.stage}`);

  let restoreInbox = stubReadInbox(async () => ({
    messages: [
      { id: 'msg-1', threadId: 'thread-1', sender: email1, subject: 'Re: role', preview: { body: 'Thanks for reaching out! I would love to chat, are you free this week?' } },
    ],
  }));
  let restoreProvider = stubProvider('{"category": "Positive", "schedulingRequestDetected": true}');

  result = await responseAgent.detectResponses();
  restoreInbox();
  restoreProvider();

  assert.strictEqual(result.matched, 1, `expected 1 match, got ${result.matched}`);
  assert.strictEqual(result.classifications[0].classification, 'Positive');
  assert.strictEqual(result.classifications[0].schedulingRequestDetected, true);
  console.log('✓ detectResponses: matches a reply to the correct pipeline by contact email and classifies it correctly');

  const updatedTask1 = await memory.getTask(sentRecord1.id);
  assert.strictEqual(updatedTask1.payload.stage, outreachPipeline.STAGES.RESPONSE_RECEIVED);
  console.log('✓ detectResponses: a genuine response moves the pipeline to RESPONSE_RECEIVED');

  // Case 3: re-running detectResponses does NOT reprocess the same message (dedup).
  restoreInbox = stubReadInbox(async () => ({
    messages: [
      { id: 'msg-1', threadId: 'thread-1', sender: email1, subject: 'Re: role', preview: { body: 'Thanks for reaching out! I would love to chat, are you free this week?' } },
    ],
  }));
  restoreProvider = stubProvider('{"category": "Positive", "schedulingRequestDetected": true}');
  result = await responseAgent.detectResponses();
  restoreInbox();
  restoreProvider();
  assert.strictEqual(result.matched, 0, 'a pipeline already at RESPONSE_RECEIVED should not be re-matched against inbox messages');
  console.log('✓ detectResponses: an already-responded pipeline is not reprocessed on subsequent runs');

  // Case 4: an automated/out-of-office reply does NOT move the pipeline to RESPONSE_RECEIVED.
  const { record: sentRecord2, contactEmail: email2 } = await sendOneOpportunity(outreachPipeline, 'p3-automated');
  restoreInbox = stubReadInbox(async () => ({
    messages: [
      { id: 'msg-2', threadId: 'thread-2', sender: email2, subject: 'Out of Office', preview: { body: 'I am currently out of office and will respond when I return.' } },
    ],
  }));
  restoreProvider = stubProvider('{"category": "Automated response", "schedulingRequestDetected": false}');
  result = await responseAgent.detectResponses();
  restoreInbox();
  restoreProvider();

  assert.strictEqual(result.matched, 1);
  const updatedTask2 = await memory.getTask(sentRecord2.id);
  assert.strictEqual(updatedTask2.payload.stage, outreachPipeline.STAGES.SENT, 'an automated/out-of-office reply must NOT stop the follow-up sequence');
  console.log('✓ detectResponses: an automated/out-of-office reply is logged but does NOT stop the follow-up sequence');

  // Case 5: a reply from an unrelated, untracked address is ignored entirely.
  const { record: sentRecord3 } = await sendOneOpportunity(outreachPipeline, 'p3-unrelated');
  restoreInbox = stubReadInbox(async () => ({
    messages: [
      { id: 'msg-3', threadId: 'thread-3', sender: 'someone-else@unrelated.com', subject: 'Hello', preview: { body: 'Random unrelated email.' } },
    ],
  }));
  restoreProvider = stubProvider('{"category": "Positive", "schedulingRequestDetected": false}');
  result = await responseAgent.detectResponses();
  restoreInbox();
  restoreProvider();
  assert.strictEqual(result.matched, 0, 'a message from an untracked sender must never be matched to any pipeline');
  const updatedTask3 = await memory.getTask(sentRecord3.id);
  assert.strictEqual(updatedTask3.payload.stage, outreachPipeline.STAGES.SENT);
  console.log('✓ detectResponses: replies from untracked senders are ignored entirely');

  // Case 6: LLM classification failure falls back safely to Neutral, never a stronger category.
  restoreInbox = stubReadInbox(async () => ({
    messages: [
      { id: 'msg-4', threadId: 'thread-4', sender: email2, subject: 'Re: role', preview: { body: 'Some reply text.' } },
    ],
  }));
  restoreProvider = stubProvider('not valid json at all');
  result = await responseAgent.detectResponses();
  restoreInbox();
  restoreProvider();
  assert.strictEqual(result.classifications[0].classification, 'Neutral', 'unparseable classification must fall back to Neutral, never escalate to Rejection/Opt-out');
  console.log('✓ detectResponses: unparseable classification safely falls back to Neutral rather than escalating');

  // === Follow-up sequencing ===

  // Case 7: a freshly-sent opportunity (0 days old) is not yet due for any follow-up.
  const { record: freshRecord } = await sendOneOpportunity(outreachPipeline, 'p3-fresh');
  let followUpResult = await outreachPipeline.checkFollowUps();
  const freshTask = await memory.getTask(freshRecord.id);
  assert(!freshTask.payload.followUpsSent || freshTask.payload.followUpsSent.length === 0, 'a same-day send should not trigger any follow-up yet');
  console.log('✓ checkFollowUps: a freshly-sent opportunity (0 days old) is not yet due for a follow-up');

  // Case 8: manually backdating sentAt to simulate 5 days elapsed triggers follow-up #1 (day 4 threshold).
  const { record: dueRecord } = await sendOneOpportunity(outreachPipeline, 'p3-due');
  const dueTask = await memory.getTask(dueRecord.id);
  const backdated = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  await memory.updateTask(dueRecord.id, { payload: { ...dueTask.payload, sentAt: backdated } });

  restoreProvider = stubProvider('{"subject": "Following up", "body": "Just wanted to follow up on my earlier note."}');
  followUpResult = await outreachPipeline.checkFollowUps();
  restoreProvider();

  assert(followUpResult.queued >= 1, `expected at least 1 follow-up queued, got ${followUpResult.queued}`);
  const dueTaskAfter = await memory.getTask(dueRecord.id);
  assert.strictEqual(dueTaskAfter.payload.followUpsSent.length, 1);
  assert.strictEqual(dueTaskAfter.payload.followUpsSent[0].day, 4);
  console.log('✓ checkFollowUps: a pipeline 5 days past sentAt correctly triggers follow-up #1 (day-4 threshold)');

  // Running checkFollowUps again immediately must NOT queue a second follow-up #1.
  followUpResult = await outreachPipeline.checkFollowUps();
  const dueTaskAfterSecondRun = await memory.getTask(dueRecord.id);
  assert.strictEqual(dueTaskAfterSecondRun.payload.followUpsSent.length, 1, 'a follow-up already queued must not be queued again on the next run');
  console.log('✓ checkFollowUps: does not double-queue the same follow-up on repeated runs');

  // Case 9: a pipeline that already received a genuine response must be skipped entirely.
  const respondedTask = await memory.getTask(sentRecord1.id); // from Case 2, already RESPONSE_RECEIVED
  const backdatedResponded = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await memory.updateTask(sentRecord1.id, { payload: { ...respondedTask.payload, sentAt: backdatedResponded } });
  followUpResult = await outreachPipeline.checkFollowUps();
  const respondedTaskAfter = await memory.getTask(sentRecord1.id);
  assert(!respondedTaskAfter.payload.followUpsSent, 'a pipeline that already received a genuine response must never get a follow-up queued');
  console.log('✓ checkFollowUps: a pipeline that already received a response is skipped, even if long overdue');

  // Case 10: maxFollowUps caps the sequence even if enough days have passed for all three.
  const config = require('../config');
  const originalMax = config.outreach.maxFollowUps;
  config.outreach.maxFollowUps = 1;

  const { record: capRecord } = await sendOneOpportunity(outreachPipeline, 'p3-cap');
  const capTask = await memory.getTask(capRecord.id);
  const veryOld = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await memory.updateTask(capRecord.id, { payload: { ...capTask.payload, sentAt: veryOld } });

  restoreProvider = stubProvider('{"subject": "Following up", "body": "Bumping this."}');
  await outreachPipeline.checkFollowUps(); // should queue follow-up #1 only
  const afterFirstCheck = await outreachPipeline.checkFollowUps(); // should queue nothing more - cap reached
  restoreProvider();

  const capTaskAfter = await memory.getTask(capRecord.id);
  assert.strictEqual(capTaskAfter.payload.followUpsSent.length, 1, `maxFollowUps=1 should cap the sequence at 1 follow-up, got ${capTaskAfter.payload.followUpsSent.length}`);
  config.outreach.maxFollowUps = originalMax;
  console.log('✓ checkFollowUps: maxFollowUps correctly caps the sequence even when far overdue for more');

  console.log('\nAll response detection + follow-up (Phase 3) checks passed.');
}

main().catch((err) => {
  console.error('✗ response-followup.test.js failed:', err);
  process.exit(1);
});