const assert = require('assert');
const memory = require('../memory');

async function main() {
  const userMsg = await memory.addChatMessage({ role: 'user', content: 'Hello there', attachmentNames: [] });
  assert(userMsg.id, 'saved user message should have an id');

  const assistantMsg = await memory.addChatMessage({ role: 'assistant', content: 'Hi! How can I help?', taskId: null });
  assert(assistantMsg.id, 'saved assistant message should have an id');

  const history = await memory.listChatMessages();
  assert(history.length >= 2, 'history should contain the saved messages');
  const [first, second] = history.slice(-2);
  assert.strictEqual(first.role, 'user');
  assert.strictEqual(second.role, 'assistant');
  assert.strictEqual(first.content, 'Hello there');
  assert.strictEqual(second.content, 'Hi! How can I help?');
  console.log('✓ chat messages persist in order with correct content');

  await memory.addChatMessage({ role: 'user', content: 'Sent photo.png', attachmentNames: ['photo.png'] });
  await memory.addChatMessage({ role: 'assistant', content: 'Task created', taskId: 'task-abc-123' });
  const fullHistory = await memory.listChatMessages();
  assert(fullHistory.find((m) => m.attachmentNames?.includes('photo.png')), 'attachment names should be preserved');
  assert(fullHistory.find((m) => m.taskId === 'task-abc-123'), 'task id should be preserved on the assistant reply');
  console.log('✓ attachment names and task references are preserved');

  const limited = await memory.listChatMessages(2);
  assert.strictEqual(limited.length, 2, 'limit parameter should be respected');
  console.log('✓ history limit is respected');

  console.log('\nAll chat history checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
