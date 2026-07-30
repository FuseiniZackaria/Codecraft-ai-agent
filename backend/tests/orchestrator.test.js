const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const orchestrator = require('../core/orchestrator');
const memory = require('../memory');
const { classify } = require('../core/orchestrator/planner');

async function main() {
  const plugins = loadPlugins();
  assert(plugins.includes('gmail'), 'gmail plugin should load');
  console.log('✓ plugin loader registered gmail');

  // 1. Non-irreversible goal -> routed to research agent, runs to completion
  const [task1] = await orchestrator.submitGoal('Research competitors in the AI automation space');
  assert.strictEqual(task1.status, 'done', 'research task should complete');
  assert(Array.isArray(task1.result) && task1.result.length === 2, 'research agent should run 2 planned steps');
  console.log('✓ research goal decomposed, executed, and reflected on');

  // 1b. Step 2 must actually receive step 1's output (regression check - this was silently
  // broken before: each step ran blind with no shared context).
  const [findingsStep, summaryStep] = task1.result;
  assert(findingsStep.text && findingsStep.text.length > 0, 'step 1 should produce text');
  // The mock provider echoes back a slice of its prompt, so if context was threaded through,
  // step 2's prompt (and therefore its echoed response) contains step 1's output.
  assert(
    summaryStep.text.includes('Context from previous steps'),
    'step 2 prompt should include step 1 output as context'
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

  // 3. Approve it -> COMPOSIO_API_KEY isn't configured in this test environment,
  // so it should fail with a clear, honest error - not silently pretend to send.
  const approved = await orchestrator.approveTask(task2.id);
  assert.strictEqual(approved.status, 'failed');
  assert(
    approved.result.error.includes('COMPOSIO_API_KEY not configured'),
    'missing Composio key should fail with a clear config error, not a fake success'
  );
  console.log('✓ approved task correctly fails with a clear error when Composio is not configured');

  // 4. Audit log should reflect all of the above
  const audit = await memory.getAuditLog();
  assert(audit.some((e) => e.action === 'approval_required'));
  assert(audit.some((e) => e.action === 'task_approved'));
  console.log('✓ audit log captured approval workflow');

  // 5. Personal Assistant Agent - inbox triage routes correctly and fails
  // gracefully without Composio configured (same honest-failure pattern as
  // the other Gmail actions, not a crash).
  const [task4] = await orchestrator.submitGoal('Check my inbox and reply to what needs a reply');
  assert.strictEqual(task4.agent, 'personal-assistant', 'inbox triage should route to the Personal Assistant Agent');
  assert.strictEqual(task4.status, 'failed', 'should fail cleanly without Composio configured, not crash');
  console.log('✓ inbox triage goal routes to Personal Assistant Agent and fails gracefully without Composio');

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
