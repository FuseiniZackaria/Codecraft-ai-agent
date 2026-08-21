const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const orchestrator = require('../core/orchestrator');
const memory = require('../memory');
const config = require('../config');
const { classify } = require('../core/orchestrator/planner');
const mockProvider = require('../core/providers/mockProvider');
const aiProvider = require('../core/providers/aiProvider');
const toolRegistry = require('../tools/ToolRegistry');

/**
 * Captures the actual `prompt` sent to whichever provider ends up handling
 * a call - mock (no API key) or the real one (a key is configured). This
 * verifies OUR OWN prompt-construction logic (context-threading in
 * BaseAgent.execute()), which is provider-agnostic, rather than inferring
 * it indirectly by checking the model's OUTPUT for an internal
 * prompt-engineering phrase - that approach only ever worked by coincidence
 * of the mock provider echoing its prompt back; a real model would never
 * literally repeat "Context from previous steps" in its actual summary.
 */
function capturePrompts() {
  const captured = [];
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = async (args) => { captured.push(args.prompt); return originalMock.call(mockProvider, args); };
  aiProvider.complete = async (args) => { captured.push(args.prompt); return originalAi.call(aiProvider, args); };
  return {
    captured,
    restore: () => { mockProvider.complete = originalMock; aiProvider.complete = originalAi; },
  };
}

/**
 * Forces a deterministic sequence of responses regardless of which provider
 * the environment would normally select - patches BOTH mock and the real
 * provider, since a real AI_API_KEY on the test machine means aiProvider
 * gets selected, not mockProvider, and only patching the latter would
 * silently do nothing there (the same mistake already made and fixed once
 * in this file's own history - worth guarding against for good).
 */
function forceProviderResponses(responses) {
  let call = 0;
  const next = () => {
    const text = responses[Math.min(call, responses.length - 1)];
    call++;
    return { text, provider: 'test-stub', costEstimate: 0 };
  };
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = async () => next();
  aiProvider.complete = async () => next();
  return () => { mockProvider.complete = originalMock; aiProvider.complete = originalAi; };
}

async function main() {
  const plugins = loadPlugins();
  assert(plugins.includes('gmail'), 'gmail plugin should load');
  console.log('✓ plugin loader registered gmail');

  // 1. Non-irreversible goal -> routed to research agent, runs to completion.
  // Step count depends on whether a real TAVILY_API_KEY is configured -
  // 3 steps (search -> analyze -> summarize) with one, 2 (analyze -> summarize)
  // without. Hardcoding one number here was a real, latent bug: it only ever
  // held in an environment with no real Tavily key, like this test previously
  // only ever ran against.
  const promptCapture = capturePrompts();
  let task1;
  try {
    [task1] = await orchestrator.submitGoal('Research competitors in the AI automation space');
  } finally {
    promptCapture.restore();
  }
  assert.strictEqual(task1.status, 'done', 'research task should complete');
  const expectedSteps = config.search.tavilyKey ? 3 : 2;
  assert(
    Array.isArray(task1.result) && task1.result.length === expectedSteps,
    `research agent should run ${expectedSteps} planned steps (tavilyKey configured: ${!!config.search.tavilyKey}), got ${task1.result?.length}`
  );
  console.log('✓ research goal decomposed, executed, and reflected on');

  // 1b. Step 2 must actually receive step 1's output (regression check - this was silently
  // broken before: each step ran blind with no shared context). The findings/summary steps
  // are always the LAST TWO steps regardless of whether a search step precedes them - and
  // correspondingly, the last two CAPTURED PROMPTS are the ones that matter here.
  const [findingsStep, summaryStep] = task1.result.slice(-2);
  assert(findingsStep.text && findingsStep.text.length > 0, 'findings step should produce text');
  const summaryPrompt = promptCapture.captured[promptCapture.captured.length - 1];
  assert(
    summaryPrompt.includes('Context from previous steps') && summaryPrompt.includes(findingsStep.text.slice(0, 30)),
    'the prompt actually sent for the summary step should include the findings step output as context'
  );
  console.log('✓ multi-step plan correctly threads context between steps');

  // 2. Irreversible goal (send email) -> should require approval, not execute immediately
  const [task2] = await orchestrator.submitGoal('Send an email to the prospect', {
    payload: { to: 'prospect@example.com', subject: 'Following up', body: 'Great chatting today.' },
  });
  assert.strictEqual(task2.status, 'pending_approval', 'irreversible task should pause for approval');
  console.log('✓ irreversible action correctly blocked pending human approval');

  // 2b. Regression check - the Chat UI submits goals as plain text with NO explicit
  // payload (this previously caused approve() to fail before ever reaching Composio,
  // because payload silently ended up undefined). The planner should always produce
  // a payload object, even if extraction found nothing, so the failure (if any) comes
  // from the tool itself with a clear message - not from a missing/undefined payload.
  const [task3] = await orchestrator.submitGoal('Send an email to the prospect about the proposal');
  assert.strictEqual(task3.status, 'pending_approval');
  assert.notStrictEqual(task3.payload, undefined, 'payload must never be undefined for a tool-call task');
  console.log('✓ goal with no explicit payload still produces a valid payload object');

  // 3. approveTask() must correctly reflect whatever the underlying tool
  // does - success or failure - without ever making a real network call.
  // This previously assumed Composio was unconfigured (only true in a
  // sandbox with no real credentials) and would have attempted an ACTUAL
  // Gmail send to a hardcoded fake address on any fully-configured
  // machine - a real side effect a test should never have. Stub the tool
  // directly instead, so this is deterministic in every environment.
  const originalGmailTool = toolRegistry.tools.get('gmail.sendEmail');

  toolRegistry.tools.set('gmail.sendEmail', {
    ...originalGmailTool,
    run: async () => { throw new Error('Simulated failure: Composio not configured'); },
  });
  let approvedFailure;
  try {
    approvedFailure = await orchestrator.approveTask(task2.id);
  } finally {
    toolRegistry.tools.set('gmail.sendEmail', originalGmailTool);
  }
  assert.strictEqual(approvedFailure.status, 'failed');
  assert(
    approvedFailure.result.error.includes('Simulated failure'),
    'a failing tool call should surface a clear error, not a fake success'
  );
  console.log('✓ approveTask() correctly surfaces a tool failure as a failed task, with no real network call');

  toolRegistry.tools.set('gmail.sendEmail', {
    ...originalGmailTool,
    run: async () => ({ status: 'sent', simulated: true }),
  });
  let approvedSuccess;
  try {
    approvedSuccess = await orchestrator.approveTask(task3.id);
  } finally {
    toolRegistry.tools.set('gmail.sendEmail', originalGmailTool);
  }
  assert.strictEqual(approvedSuccess.status, 'done');
  console.log('✓ approveTask() correctly marks the task done on a successful tool call, with no real network call');

  // 4. Audit log should reflect all of the above
  const audit = await memory.getAuditLog();
  assert(audit.some((e) => e.action === 'approval_required'));
  assert(audit.some((e) => e.action === 'task_approved'));
  console.log('✓ audit log captured approval workflow');

  // 5. Personal Assistant Agent - inbox triage routes correctly and fails
  // cleanly (not a crash) when the underlying tool fails. Stub gmail.readInbox
  // directly rather than relying on Composio being unconfigured - on a fully
  // configured machine this would otherwise make a REAL call reading the
  // user's actual inbox on every test run, a real side effect a test should
  // never have.
  const originalReadInbox = toolRegistry.tools.get('gmail.readInbox');

  toolRegistry.tools.set('gmail.readInbox', {
    ...originalReadInbox,
    run: async () => { throw new Error('Simulated failure: Composio not configured'); },
  });
  let task4;
  try {
    [task4] = await orchestrator.submitGoal('Check my inbox and reply to what needs a reply');
  } finally {
    toolRegistry.tools.set('gmail.readInbox', originalReadInbox);
  }
  assert.strictEqual(task4.agent, 'personal-assistant', 'inbox triage should route to the Personal Assistant Agent');
  assert.strictEqual(task4.status, 'failed', 'should fail cleanly when the tool fails, not crash');
  console.log('✓ inbox triage fails cleanly on a tool failure, with no real inbox access');

  // 5b. Success path - the actual core behavior this agent exists for: read
  // the inbox, identify what needs a reply, and spawn a separate
  // approval-gated task per reply. This previously had zero deterministic
  // test coverage at all.
  toolRegistry.tools.set('gmail.readInbox', {
    ...originalReadInbox,
    run: async () => ({
      messages: [{ threadId: 'thread-1', sender: 'client@example.com', subject: 'Quick question', preview: { body: 'Are you free Tuesday?' } }],
    }),
  });
  const triageAnalysis = JSON.stringify([
    { threadId: 'thread-1', from: 'client@example.com', subject: 'Quick question', needsReply: true, draftReply: 'Yes, Tuesday works for me.' },
  ]);
  const restoreTriageProvider = forceProviderResponses([
    '{"category": "inbox_triage"}', // classification
    triageAnalysis, // the LLM analysis step
  ]);

  let task4b;
  try {
    [task4b] = await orchestrator.submitGoal('Check my inbox and reply to what needs a reply');
  } finally {
    restoreTriageProvider();
    toolRegistry.tools.set('gmail.readInbox', originalReadInbox);
  }
  assert.strictEqual(task4b.status, 'done', 'a successful triage run should complete');
  const allTasks = await memory.listTasks();
  const spawnedReply = allTasks.find((t) => t.toolCall?.tool === 'gmail.replyToThread' && t.payload?.threadId === 'thread-1');
  assert(spawnedReply, 'triage should spawn a separate approval-gated task for the email needing a reply');
  assert.strictEqual(spawnedReply.status, 'pending_approval', 'the spawned reply must wait for approval, never auto-send');
  console.log('✓ a successful triage run correctly spawns an approval-gated reply task, with no real inbox access');

  // 6. Regression check - "prospect" alone must not misroute an ordinary
  // send-email request to the Sales Agent's lead-gen mode (this broke once
  // already when the keyword was too broad).
  const [task5] = await orchestrator.submitGoal('Send an email to the prospect', {
    payload: { to: 'x@example.com', subject: 'Hi', body: 'Hello' },
  });
  assert.strictEqual(task5.status, 'pending_approval', '"prospect" alone should not trigger lead-gen routing');
  console.log('✓ ordinary "prospect" phrasing still routes to a normal send, not lead-gen');

  // 7. Regression check - plain research/lookup phrasing must be classified
  // as actionable (this broke once: chat.js's isActionable check never
  // included research at all, so genuine research requests silently fell
  // through to plain conversational chat instead of running real search).
  const researchPhrases = [
    'Find me remote software development opportunities outside Accra',
    'Research the top CRM tools for small businesses',
    'Look up recent WhatsApp API pricing changes',
    'Find the best project management tools for startups',
  ];
  for (const phrase of researchPhrases) {
    const { isActionable, isResearch } = classify(phrase);
    assert(isActionable, `"${phrase}" should be classified as actionable`);
    assert(isResearch, `"${phrase}" should be classified as research`);
  }
  console.log('✓ research/lookup phrasing is correctly classified as actionable');

  // 7b. Guard the fix above didn't break the actual WhatsApp-send feature.
  const sendCheck = classify('Send a whatsapp message to +233123456789 saying hello');
  assert(sendCheck.isWhatsApp, 'an actual WhatsApp send request should still be classified as isWhatsApp');
  assert(!sendCheck.isResearch, 'an actual WhatsApp send request should not also be classified as research');
  console.log('✓ genuine WhatsApp-send requests still route correctly');

  // 8. Regression check - "write a marketing email" contains the word
  // "email" and must NOT be misrouted into an actual send attempt.
  const marketingCheck = classify('Write a marketing email announcing our new feature');
  assert(marketingCheck.isMarketing, 'marketing content request should be classified as marketing');
  assert(!marketingCheck.isEmailSend, 'marketing content request should not trigger an actual email send');
  console.log('✓ "marketing email" phrasing routes to Marketing Agent, not a real send');

  // 9. CEO strategy phrasing routes correctly and doesn't collide with other categories.
  const ceoCheck = classify('Should we prioritize the WhatsApp integration or the Slack one next quarter?');
  assert(ceoCheck.isCEO, 'strategy question should be classified as CEO');
  assert(!ceoCheck.isEmailSend && !ceoCheck.isMarketing, 'strategy question should not collide with other categories');
  console.log('✓ strategy phrasing routes to CEO Agent');

  // 10. Regression check - a strategy question that merely mentions "inbox
  // triage" as a topic must NOT trigger a real Gmail read (this actually
  // happened: "improving inbox triage next quarter" ran live triage instead
  // of answering the strategy question).
  const inboxCollisionCheck = classify('Should we prioritize the WhatsApp integration or improving inbox triage next quarter?');
  assert(inboxCollisionCheck.isCEO, 'strategy question mentioning "inbox triage" should still be classified as CEO');
  assert(!inboxCollisionCheck.isInboxTriage, 'strategy question should not trigger a real inbox triage');
  console.log('✓ strategy question mentioning "inbox triage" does not trigger a real Gmail read');

  // 11. GitHub repo creation routes correctly and doesn't collide with
  // research/CEO questions that merely mention "github" as a topic.
  const githubCheck = classify('Create a github repo called my-new-project');
  assert(githubCheck.isGithub, 'github repo creation should be classified as github');
  assert(!githubCheck.isMarketing && !githubCheck.isEmailSend, 'should not collide with other categories');

  const githubResearchCheck = classify('Look up how github actions billing works');
  assert(!githubResearchCheck.isGithub, 'a question merely mentioning github should not trigger repo creation');
  console.log('✓ github repo creation routes correctly without colliding with research questions');

  console.log('\nAll orchestrator integration checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
