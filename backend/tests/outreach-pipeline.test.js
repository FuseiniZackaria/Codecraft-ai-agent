const assert = require('assert');

process.env.TAVILY_API_KEY = 'test-tavily-key-p2';

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const mockProvider = require('../core/providers/mockProvider');
const aiProvider = require('../core/providers/aiProvider');
const memory = require('../memory');

// Patches BOTH providers, not just mockProvider. core/router.js's
// selectProvider() picks the real 'ai' provider over 'mock' whenever a real
// API key is configured - so a stub touching only mockProvider silently
// does nothing in any environment with real credentials set, and the test
// ends up hitting a real, non-deterministic LLM call instead of the fixture.
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

async function main() {
  loadPlugins();

  const config = require('../config');
  const outreachPipeline = require('../core/outreachPipeline');
  const { STAGES, MODES } = outreachPipeline;

  const strongOpportunity = {
    company: 'Acme Corp',
    companyWebsite: 'https://www.acmecorp.com',
    jobTitle: 'Senior Backend Engineer',
    jobDescription: 'Backend engineer skilled in Node.js and distributed systems.',
    applicationUrl: 'https://www.acmecorp.com/careers/senior-backend-engineer',
    postedDate: new Date().toISOString(),
    source: 'company careers page',
    contactEmail: 'hiring@acmecorp.com',
  };

  const companySearchStub = async () => ({
    answer: null,
    results: [{ title: 'Acme Corp Careers', url: 'https://www.acmecorp.com/careers', content: 'We are hiring' }],
  });

  // --- Manual mode: verifies only, never drafts or sends ---
  let restoreSearch = stubWebSearch(companySearchStub);
  let restoreProvider = stubProvider('14');
  let record = await outreachPipeline.processOpportunity({ ...strongOpportunity, id: 'p2-manual' }, { mode: MODES.MANUAL });
  restoreSearch();
  restoreProvider();

  assert.strictEqual(record.stage, STAGES.VERIFIED, `manual mode should stop at VERIFIED, got ${record.stage}`);
  assert(!record.draft, 'manual mode must never draft outreach automatically');
  console.log('✓ Manual mode: verifies opportunity, stops before drafting or sending anything');

  // --- Semi-automatic mode: drafts, creates approval task, but never sends on its own ---
  restoreSearch = stubWebSearch(companySearchStub);
  restoreProvider = stubProvider(['14', '{"subject": "Quick note about the Backend Engineer role", "body": "Hi there - saw the opening and thought I would reach out."}']);
  let sendCalled = false;
  let restoreSend = stubGmailSend(async () => { sendCalled = true; return { status: 'sent' }; });

  record = await outreachPipeline.processOpportunity({ ...strongOpportunity, id: 'p2-semi' }, { mode: MODES.SEMI_AUTOMATIC });
  restoreSearch();
  restoreProvider();
  restoreSend();

  assert.strictEqual(record.stage, STAGES.AWAITING_APPROVAL, `semi-automatic should stop at AWAITING_APPROVAL, got ${record.stage}`);
  assert(record.draft && record.draft.subject && record.draft.body, 'semi-automatic mode should draft outreach');
  assert(record.approvalTaskId, 'semi-automatic mode should create an approval task');
  assert.strictEqual(sendCalled, false, 'semi-automatic mode must NEVER send without explicit human approval');
  console.log('✓ Semi-automatic mode: drafts outreach and creates an approval task, but never sends without a human');

  // Confirm the approval task actually exists and going through the REAL
  // approval flow would work (proves this isn't a fake task object).
  const approvalTask = await memory.getTask(record.approvalTaskId);
  assert.strictEqual(approvalTask.status, 'pending_approval');
  assert.strictEqual(approvalTask.toolCall.tool, 'gmail.sendEmail');
  console.log('✓ Semi-automatic mode: the created approval task is a real pending_approval task using the standard gmail.sendEmail gate');

  // --- Automatic mode, but automaticEnabled is OFF (default) - must behave like semi-automatic ---
  assert.strictEqual(config.outreach.automaticEnabled, false, 'automatic sending must be disabled by default');
  restoreSearch = stubWebSearch(companySearchStub);
  restoreProvider = stubProvider(['14', '{"subject": "Re: Backend Engineer", "body": "Hi - reaching out about the role."}']);
  sendCalled = false;
  restoreSend = stubGmailSend(async () => { sendCalled = true; return { status: 'sent' }; });

  record = await outreachPipeline.processOpportunity({ ...strongOpportunity, id: 'p2-auto-disabled' }, { mode: MODES.AUTOMATIC });
  restoreSearch();
  restoreProvider();
  restoreSend();

  assert.strictEqual(record.stage, STAGES.AWAITING_APPROVAL, 'automatic mode without automaticEnabled must NOT send - stops at approval');
  assert.strictEqual(sendCalled, false, 'automatic mode must respect the automaticEnabled=false safety default');
  console.log('✓ Automatic mode with automaticEnabled=false (the default) never sends - degrades to awaiting approval');

  // --- Automatic mode WITH automaticEnabled explicitly true, and every condition met ---
  config.outreach.automaticEnabled = true;
  restoreSearch = stubWebSearch(companySearchStub);
  restoreProvider = stubProvider(['14', '{"subject": "Re: Backend Engineer", "body": "Hi - reaching out about the role."}']);
  sendCalled = false;
  let sentPayload = null;
  restoreSend = stubGmailSend(async (args) => { sendCalled = true; sentPayload = args; return { status: 'sent' }; });

  record = await outreachPipeline.processOpportunity({ ...strongOpportunity, id: 'p2-auto-enabled' }, { mode: MODES.AUTOMATIC });
  restoreSearch();
  restoreProvider();
  restoreSend();
  config.outreach.automaticEnabled = false; // restore default immediately

  assert.strictEqual(sendCalled, true, 'when explicitly enabled and every condition is met, automatic mode should actually send');
  assert.strictEqual(record.stage, STAGES.SENT);
  assert.strictEqual(sentPayload.to, strongOpportunity.contactEmail);
  console.log('✓ Automatic mode with automaticEnabled=true and all conditions met: sends through the real approval-execution path');

  // --- Automatic mode WITH automaticEnabled true, but a weak/unverified opportunity - must still refuse to send ---
  config.outreach.automaticEnabled = true;
  restoreSearch = stubWebSearch(async () => ({ answer: null, results: [] }));
  restoreProvider = stubProvider('5');
  sendCalled = false;
  restoreSend = stubGmailSend(async () => { sendCalled = true; return { status: 'sent' }; });

  const weakOpportunity = {
    id: 'p2-auto-weak',
    company: 'Random Co',
    jobTitle: 'Assistant',
    applicationUrl: 'https://randomjobboard.example/1',
    postedDate: '2020-01-01T00:00:00Z',
    source: 'aggregator',
  };
  record = await outreachPipeline.processOpportunity(weakOpportunity, { mode: MODES.AUTOMATIC });
  restoreSearch();
  restoreProvider();
  restoreSend();
  config.outreach.automaticEnabled = false;

  assert.strictEqual(sendCalled, false, 'automatic mode must never send for a weak/unverified opportunity, even when enabled');
  assert(record.stage === STAGES.REJECTED_VERIFICATION || record.stage === STAGES.REJECTED_CONTACT, `weak opportunity should be rejected, got stage ${record.stage}`);
  console.log('✓ Automatic mode (even when enabled) refuses to auto-send a weak/unverified opportunity');

  // --- Daily send limit is respected ---
  config.outreach.dailySendLimit = 0;
  config.outreach.automaticEnabled = true;
  restoreSearch = stubWebSearch(companySearchStub);
  restoreProvider = stubProvider(['14', '{"subject": "Re: role", "body": "Hi there."}']);
  sendCalled = false;
  restoreSend = stubGmailSend(async () => { sendCalled = true; return { status: 'sent' }; });

  record = await outreachPipeline.processOpportunity({ ...strongOpportunity, id: 'p2-daily-limit' }, { mode: MODES.AUTOMATIC });
  restoreSearch();
  restoreProvider();
  restoreSend();
  config.outreach.automaticEnabled = false;
  config.outreach.dailySendLimit = 10;

  assert.strictEqual(sendCalled, false, 'daily send limit of 0 must block automatic sending');
  assert.strictEqual(record.stage, STAGES.AWAITING_APPROVAL);
  console.log('✓ Daily outreach send limit is enforced even in automatic mode');

  // --- Rejected opportunity never reaches drafting stage at all ---
  restoreSearch = stubWebSearch(async () => ({ answer: null, results: [] }));
  restoreProvider = stubProvider('5');
  record = await outreachPipeline.processOpportunity(
    { id: 'p2-rejected', company: 'Sketchy LLC', jobTitle: 'Role', applicationUrl: 'https://sketchy.example/1', postedDate: '2019-01-01T00:00:00Z', source: 'random' },
    { mode: MODES.SEMI_AUTOMATIC }
  );
  restoreSearch();
  restoreProvider();

  assert.strictEqual(record.stage, STAGES.REJECTED_VERIFICATION);
  assert(!record.draft, 'a rejected opportunity must never reach the drafting stage');
  console.log('✓ Unverified opportunity is rejected before ever reaching outreach drafting, even in semi-automatic mode');

  console.log('\nAll outreach pipeline (Phase 2) checks passed.');
}

main().catch((err) => {
  console.error('✗ outreach-pipeline.test.js failed:', err);
  process.exit(1);
});