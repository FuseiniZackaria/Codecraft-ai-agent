// Force the in-memory store so this test is self-contained and does not
// require a live Supabase migration to have run first. Each test file runs
// in its own node process, so this does not affect other tests.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';

const assert = require('assert');
const memory = require('../memory');
const { v4: uuid } = require('uuid');

async function main() {
  // --- 1. Round-trip: create, lookup by threadId, lookup by approvedTaskId ---
  const approvedTaskId = uuid();
  const created = await memory.createOutreachThread({
    threadId: 'ot-thread-1',
    recipientEmail: 'LEAD@Example.com', // mixed case to prove normalization
    companyName: 'Example Co',
    agentKey: 'sales',
    campaign: 'lead_gen',
    outreachStatus: 'draft',
    approvedTaskId,
  });
  assert.ok(created.id, 'createOutreachThread returns a row with an id');
  assert.strictEqual(created.recipientEmail, 'lead@example.com', 'recipient email is lowercased on write');

  const byThread = await memory.getOutreachThreadByThreadId('ot-thread-1');
  assert.ok(byThread, 'lookup by threadId finds the row');
  assert.strictEqual(byThread.agentKey, 'sales');

  const byTask = await memory.getOutreachThreadByApprovedTask(approvedTaskId);
  assert.ok(byTask, 'lookup by approvedTaskId finds the row');
  assert.strictEqual(byTask.id, created.id);
  console.log('✓ outreach-threads: create + lookup round-trip works, email is normalized on write');

  // --- 2. Update: status flips, lastMessageId recorded ---
  const updated = await memory.updateOutreachThread(created.id, {
    outreachStatus: 'sent',
    lastMessageId: 'msg-abc',
  });
  assert.strictEqual(updated.outreachStatus, 'sent');
  assert.strictEqual(updated.lastMessageId, 'msg-abc');
  console.log('✓ outreach-threads: update flips status and records lastMessageId');

  // --- 3. listOutreachThreadsByRecipient returns all rows for an email (case-insensitive) ---
  await memory.createOutreachThread({
    threadId: 'ot-thread-2',
    recipientEmail: 'lead@example.com',
    agentKey: 'response-detection',
    outreachStatus: 'replied',
  });
  const rowsForLead = await memory.listOutreachThreadsByRecipient('LEAD@EXAMPLE.COM');
  assert.ok(rowsForLead.length >= 2, 'listOutreachThreadsByRecipient returns both rows for the lead');
  console.log('✓ outreach-threads: list by recipient is case-insensitive and finds every row');

  // --- 4. Missing/unknown lookups return null, not throw ---
  const missing = await memory.getOutreachThreadByThreadId('does-not-exist');
  assert.strictEqual(missing, null);
  const missingByTask = await memory.getOutreachThreadByApprovedTask(uuid());
  assert.strictEqual(missingByTask, null);
  console.log('✓ outreach-threads: unknown lookups return null rather than throwing');

  // --- 5. The guard uses this registry to enforce lane isolation. End-to-end
  //     this is covered by gmail-guard.test.js (PA cannot reply to a Sales
  //     thread), so here we just verify the row is shaped the way the guard
  //     expects: agentKey + recipientEmail must be present and non-empty.
  assert.ok(byThread.agentKey, 'agentKey is populated so the guard can enforce agent ownership');
  assert.ok(byThread.recipientEmail, 'recipientEmail is populated so the guard can enforce recipient match');
  console.log('✓ outreach-threads: row shape carries the fields the Gmail guard reads');

  console.log('\nAll outreach_threads memory checks passed.');
}

main().catch((err) => {
  console.error('✗ outreach-threads.test.js failed:', err);
  process.exit(1);
});
