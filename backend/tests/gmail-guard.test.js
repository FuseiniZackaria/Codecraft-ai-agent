// Force the in-memory store so the guard, orchestrator, and outreach_threads
// registry are all pinned to a deterministic self-contained backend. Each
// test file runs in its own node process.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';

const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const memory = require('../memory');
const config = require('../config');
const toolRegistry = require('../tools/ToolRegistry');
const composio = require('../core/composio');
const orchestrator = require('../core/orchestrator');
const { GmailGuardError, guardSend, guardReply, fingerprintBody } = require('../plugins/gmail/guard');
const { v4: uuid } = require('uuid');

function stubComposioExecute(fn) {
  const original = composio.execute;
  composio.execute = fn;
  return () => { composio.execute = original; };
}

async function main() {
  loadPlugins();
  const originalApplicantEmail = config.applicant?.email;
  if (config.applicant) config.applicant.email = 'owner@example.com';

  // --- 1. systemDigest path: owner-only, refuses other recipients ---
  const okOwner = await guardSend(
    { to: 'owner@example.com', subject: 'test', body: 'hi' },
    { systemDigest: true, role: 'sales' }
  );
  assert.strictEqual(okOwner.kind, 'systemDigest');

  await assert.rejects(
    () => guardSend({ to: 'someone-else@example.com', subject: 'test', body: 'hi' }, { systemDigest: true, role: 'sales' }),
    (err) => err instanceof GmailGuardError && err.code === 'systemDigest_recipient_mismatch'
  );
  console.log('✓ gmail-guard: systemDigest allows the owner address, refuses any other recipient');

  // --- 2. A send with no approvedTaskId at all is refused ---
  await assert.rejects(
    () => guardSend({ to: 'anyone@example.com', subject: 't', body: 'b' }, { role: 'sales' }),
    (err) => err instanceof GmailGuardError && err.code === 'no_approval'
  );
  console.log('✓ gmail-guard: a send without approvedTaskId or systemDigest is refused ("no_approval")');

  // --- 3. A send with an approvedTaskId pointing nowhere is refused ---
  await assert.rejects(
    () => guardSend({ to: 'anyone@example.com', subject: 't', body: 'b' }, { approvedTaskId: 'does-not-exist' }),
    (err) => err instanceof GmailGuardError && err.code === 'task_not_found'
  );
  console.log('✓ gmail-guard: a bogus approvedTaskId is refused ("task_not_found")');

  // --- 4. A legit send goes through the full approveTask path and is accepted ---
  const [draft] = await orchestrator.submitGoal('Send an email to lead@example.com about our services', {
    payload: { to: 'lead@example.com', subject: 'Intro', body: 'Hello there' },
  });
  assert.strictEqual(draft.status, 'pending_approval');

  let composioCalledWith = null;
  const restoreComposio = stubComposioExecute(async (action, args) => {
    composioCalledWith = { action, args };
    return { data: { threadId: 'thread-A', id: 'msg-1' } };
  });
  const approved = await orchestrator.approveTask(draft.id);
  restoreComposio();

  assert.strictEqual(approved.status, 'done', 'legit approved send should complete');
  assert.strictEqual(composioCalledWith.args.recipient_email, 'lead@example.com');
  console.log('✓ gmail-guard: a send dispatched through orchestrator.approveTask reaches Gmail with the right payload');

  // --- 5. Tampered recipient: approve A, call tool for B -> refused ---
  const taskId2 = uuid();
  await memory.saveTask({
    id: taskId2,
    agent: 'sales',
    instruction: 'Send to alice',
    status: 'pending_approval',
    irreversible: true,
    toolCall: { tool: 'gmail.sendEmail', irreversible: true },
    payload: { to: 'alice@example.com', subject: 's', body: 'b' },
    created_at: new Date().toISOString(),
  });
  await assert.rejects(
    () => guardSend({ to: 'bob@example.com', subject: 's', body: 'b' }, { approvedTaskId: taskId2 }),
    (err) => err instanceof GmailGuardError && err.code === 'recipient_tampered'
  );
  console.log('✓ gmail-guard: a send to a recipient that does not match the approved task is refused ("recipient_tampered")');

  // --- 6. Duplicate send: approve another email to the same recipient
  //     with the same subject + body, within DEDUP window -> refused ---
  const taskId3 = uuid();
  await memory.saveTask({
    id: taskId3,
    agent: 'sales',
    instruction: 'Resend',
    status: 'pending_approval',
    irreversible: true,
    toolCall: { tool: 'gmail.sendEmail', irreversible: true },
    payload: { to: 'lead@example.com', subject: 'Intro', body: 'Hello there' },
    created_at: new Date().toISOString(),
  });
  await assert.rejects(
    () => guardSend({ to: 'lead@example.com', subject: 'Intro', body: 'Hello there' }, { approvedTaskId: taskId3 }),
    (err) => err instanceof GmailGuardError && err.code === 'duplicate_send'
  );
  console.log('✓ gmail-guard: an identical (to, subject, body) send within the dedup window is refused ("duplicate_send")');

  // --- 7. replyToThread: unknown thread with an approved task is allowed ---
  const okTaskId = uuid();
  await memory.saveTask({
    id: okTaskId,
    agent: 'personal-assistant',
    instruction: 'Reply to a friend',
    status: 'pending_approval',
    irreversible: true,
    toolCall: { tool: 'gmail.replyToThread', irreversible: true },
    payload: { threadId: 'friendly-thread', body: 'thanks', recipientEmail: 'friend@example.com' },
    created_at: new Date().toISOString(),
  });
  const reply1 = await guardReply(
    { threadId: 'friendly-thread', body: 'thanks', recipientEmail: 'friend@example.com' },
    { approvedTaskId: okTaskId }
  );
  assert.strictEqual(reply1.kind, 'approved_reply');
  assert.strictEqual(reply1.outreachThread, null);
  console.log('✓ gmail-guard: a reply to an unregistered thread, backed by an approved task, is allowed');

  // --- 8. replyToThread: thread owned by Sales, PA tries to reply -> refused ---
  await memory.createOutreachThread({
    threadId: 'sales-thread-X',
    recipientEmail: 'lead-x@example.com',
    agentKey: 'sales',
    campaign: 'lead_gen',
    outreachStatus: 'sent',
  });
  const paTaskId = uuid();
  await memory.saveTask({
    id: paTaskId,
    agent: 'personal-assistant',
    instruction: 'PA tries to reply to the lead',
    status: 'pending_approval',
    irreversible: true,
    toolCall: { tool: 'gmail.replyToThread', irreversible: true },
    payload: { threadId: 'sales-thread-X', body: 'oops', recipientEmail: 'lead-x@example.com' },
    created_at: new Date().toISOString(),
  });
  await assert.rejects(
    () => guardReply(
      { threadId: 'sales-thread-X', body: 'oops', recipientEmail: 'lead-x@example.com' },
      { approvedTaskId: paTaskId }
    ),
    (err) => err instanceof GmailGuardError && err.code === 'wrong_agent_for_thread'
  );
  console.log('✓ gmail-guard: PA cannot reply to a thread owned by Sales (lane isolation enforced)');

  // --- 9. replyToThread: Sales reply with a tampered recipient -> refused ---
  const salesTaskId = uuid();
  await memory.saveTask({
    id: salesTaskId,
    agent: 'sales',
    instruction: 'Sales reply',
    status: 'pending_approval',
    irreversible: true,
    toolCall: { tool: 'gmail.replyToThread', irreversible: true },
    payload: { threadId: 'sales-thread-X', body: 'legit reply', recipientEmail: 'lead-x@example.com' },
    created_at: new Date().toISOString(),
  });
  await assert.rejects(
    () => guardReply(
      { threadId: 'sales-thread-X', body: 'legit reply', recipientEmail: 'IMPOSTOR@example.com' },
      { approvedTaskId: salesTaskId }
    ),
    (err) => err instanceof GmailGuardError && (err.code === 'recipient_tampered' || err.code === 'thread_recipient_mismatch')
  );
  console.log('✓ gmail-guard: a reply to the right thread but with a swapped recipient is refused');

  // --- 10. Direct unauthenticated caller trying to bypass the guard
  //     by calling toolRegistry.call for gmail.sendEmail with no context ---
  await assert.rejects(
    () => toolRegistry.call('gmail.sendEmail', { to: 'random@example.com', subject: 'x', body: 'y' }, {}),
    (err) => err instanceof GmailGuardError && err.code === 'no_approval'
  );
  console.log('✓ gmail-guard: a direct toolRegistry.call with no approval context is refused at the action level, not just the orchestrator');

  // --- 11. fingerprintBody is deterministic + content-sensitive ---
  assert.strictEqual(fingerprintBody('same'), fingerprintBody('same'));
  assert.notStrictEqual(fingerprintBody('same'), fingerprintBody('different'));
  console.log('✓ gmail-guard: body fingerprint is deterministic and content-sensitive');

  if (config.applicant) config.applicant.email = originalApplicantEmail;
  console.log('\nAll Gmail guard checks passed.');
}

main().catch((err) => {
  console.error('✗ gmail-guard.test.js failed:', err);
  process.exit(1);
});
