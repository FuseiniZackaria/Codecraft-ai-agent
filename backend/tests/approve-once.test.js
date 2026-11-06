// Approving a task runs it exactly once - even if Approve is clicked three
// times while a slow send is still going (that sent a WhatsApp reply three
// times). Later approvals of a finished task are refused too.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';

const assert = require('assert');
const memory = require('../memory');
const toolRegistry = require('../tools/ToolRegistry');
const orchestrator = require('../core/orchestrator');

(async () => {
  let runs = 0;
  toolRegistry.register('test.slowSend', {
    permission: 'test',
    irreversible: true,
    run: async () => { runs += 1; await new Promise((r) => setTimeout(r, 300)); return { sent: true }; },
  });
  await memory.saveTask({
    id: 'task-approve-once', agent: 'whatsapp', instruction: 'Reply on WhatsApp', status: 'pending_approval',
    toolCall: { tool: 'test.slowSend' }, payload: { to: '233200000000', body: 'Good morning!' }, created_at: new Date().toISOString(),
  });

  // Three clicks within a moment, while the first is still sending.
  const results = await Promise.allSettled([
    orchestrator.approveTask('task-approve-once'),
    orchestrator.approveTask('task-approve-once'),
    orchestrator.approveTask('task-approve-once'),
  ]);
  assert.strictEqual(runs, 1, `the message must be sent once, was sent ${runs} times`);
  assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
  const refused = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(refused.length, 2);
  assert(refused.every((r) => r.reason.code === 'ALREADY_APPROVING'), refused.map((r) => r.reason.message).join(' | '));
  assert.strictEqual((await memory.getTask('task-approve-once')).status, 'done');
  console.log('✓ three quick Approve clicks send the message once');

  // Approving again after it's done is refused and sends nothing.
  await assert.rejects(orchestrator.approveTask('task-approve-once'), /not awaiting approval/);
  assert.strictEqual(runs, 1);
  console.log('✓ approving a finished task again sends nothing');

  toolRegistry.unregister('test.slowSend');
  console.log('All approve-once checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
