// Force the in-memory store so this test is self-contained and does not
// require a live Supabase migration to have run first.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.MY_EMAIL_ADDRESSES = 'dumenuian123@gmail.com,alias@example.com';

const assert = require('assert');
const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const memory = require('../memory');
const PersonalAssistantAgent = require('../agents/personal-assistant/PersonalAssistantAgent');
const mockProvider = require('../core/providers/mockProvider');
const aiProvider = require('../core/providers/aiProvider');
const { v4: uuid } = require('uuid');

function stubReadInbox(messages) {
  const original = toolRegistry.tools.get('gmail.readInbox');
  const capturedCalls = [];
  toolRegistry.tools.set('gmail.readInbox', {
    permission: 'gmail.read',
    irreversible: false,
    run: async (args) => {
      capturedCalls.push(args);
      return { messages };
    },
  });
  return { capturedCalls, restore: () => original ? toolRegistry.tools.set('gmail.readInbox', original) : toolRegistry.tools.delete('gmail.readInbox') };
}

function forceLlm(text) {
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = async () => ({ text, provider: 'test', costEstimate: 0 });
  aiProvider.complete = async () => ({ text, provider: 'test', costEstimate: 0 });
  return () => { mockProvider.complete = originalMock; aiProvider.complete = originalAi; };
}

async function main() {
  loadPlugins();

  // --- 1. gmail.readInbox is called with "in:inbox -from:me -in:sent" ---
  //     This is the Composio-level fix: Composio returns All Mail unless
  //     the query is set, so without this parameter the agent would see
  //     the admin's own sent mail.
  {
    const { capturedCalls, restore } = stubReadInbox([]);
    const restoreLlm = forceLlm('[]');
    try {
      const agent = new PersonalAssistantAgent();
      const task = {
        id: uuid(),
        agent: 'personal-assistant',
        instruction: 'Check my inbox and reply to what needs a reply',
        status: 'running',
        irreversible: false,
        created_at: new Date().toISOString(),
      };
      await memory.saveTask(task);
      await agent.run(task);
    } finally {
      restore();
      restoreLlm();
    }
    assert.strictEqual(capturedCalls.length, 1);
    assert.strictEqual(capturedCalls[0].query, 'in:inbox -from:me -in:sent',
      'readInbox must receive the inbox-only, exclude-self query to prevent fetching sent mail');
    console.log('✓ inbox-triage: gmail.readInbox called with "in:inbox -from:me -in:sent"');
  }

  // --- 2. A single message FROM dumenuian123@gmail.com (self) is dropped
  //     deterministically BEFORE the LLM sees it. No reply task created.
  {
    const taskId = uuid();
    const selfMessage = {
      threadId: 'thread-self-1',
      sender: 'Fuseini Zackaria <dumenuian123@gmail.com>',
      subject: 'Quick bump: Senior Backend Engineer',
      preview: { body: 'Hi team, just following up on my application...' },
      internalDate: Date.now().toString(),
    };
    const legitMessage = {
      threadId: 'thread-friend-1',
      sender: 'Jane Doe <jane@example.com>',
      subject: 'Lunch next week?',
      preview: { body: 'Want to grab lunch Tuesday?' },
      internalDate: Date.now().toString(),
    };

    const { restore } = stubReadInbox([selfMessage, legitMessage]);
    // The LLM only ever sees legitMessage after filtering. We force it to
    // respond "no reply needed" so the test asserts the filter did its job
    // without being muddied by a successful draft.
    const restoreLlm = forceLlm(
      JSON.stringify([
        { threadId: 'thread-friend-1', from: 'Jane Doe <jane@example.com>', subject: 'Lunch next week?', needsReply: false, draftReply: null },
      ])
    );

    const beforeTasks = (await memory.listTasks()).length;
    try {
      const agent = new PersonalAssistantAgent();
      const task = {
        id: taskId,
        agent: 'personal-assistant',
        instruction: 'Check my inbox and reply to what needs a reply',
        status: 'running',
        irreversible: false,
        created_at: new Date().toISOString(),
      };
      await memory.saveTask(task);
      await agent.run(task);
    } finally {
      restore();
      restoreLlm();
    }

    // No gmail.replyToThread approval task was spawned.
    const allTasks = await memory.listTasks();
    const spawnedReplies = allTasks.filter((t) =>
      t.toolCall?.tool === 'gmail.replyToThread' && t.payload?.threadId === 'thread-self-1'
    );
    assert.strictEqual(spawnedReplies.length, 0,
      'PA must never spawn a reply task for a message that came from one of the admin\'s own addresses');
    console.log('✓ inbox-triage: a self-sent "Quick bump: Senior Backend Engineer" is skipped - no reply task created');

    // Reflection summary mentions "my own emails: 1".
    const parent = allTasks.find((t) => t.id === taskId);
    // Reflection lives in memory.reflections; MemoryStore exposes it via a plain array.
    const matched = (memory.reflections || []).find((r) => r.taskId === taskId);
    assert.ok(matched, 'triage task should produce a reflection note');
    assert(/my own emails: 1/.test(matched.note),
      `summary should list "my own emails: 1"; got: ${matched.note}`);
    assert(/Skipped \d+ before triage/.test(matched.note),
      `summary should include a "Skipped N before triage" counter line; got: ${matched.note}`);
    console.log('✓ inbox-triage: reflection summary lists the sent-by-me email under "my own emails: 1"');

    // No new tasks beyond the triage parent (= beforeTasks + 1).
    assert.strictEqual(allTasks.length, beforeTasks + 1,
      'Only the triage parent task should be new - no spawned reply, no spawned anything');
    console.log('✓ inbox-triage: no spawned child tasks when every candidate is skipped');
  }

  console.log('\nAll inbox-triage self-mail checks passed.');
}

main().catch((err) => {
  console.error('✗ inbox-triage-self-mail.test.js failed:', err);
  process.exit(1);
});
