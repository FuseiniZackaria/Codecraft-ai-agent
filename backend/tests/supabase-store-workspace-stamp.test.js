// SupabaseStore must write workspace_id on task and chat rows. Without it
// every task was saved with no workspace, so an invited workspace never saw
// its own tasks (and the owner's workspace saw them instead).

process.env.CC_TESTING = '1';

const assert = require('assert');
const SupabaseStore = require('../memory/SupabaseStore');

function fakeClient(inserted) {
  const chain = {
    insert(row) { inserted.push(row); this._row = row; return this; },
    select() { return this; },
    single() { return Promise.resolve({ data: { ...this._row }, error: null }); },
    maybeSingle() { return Promise.resolve({ data: { id: 'm1', ...this._row }, error: null }); },
  };
  return { from: () => Object.create(chain) };
}

async function main() {
  const WS = 'bbbbbbbb-0000-0000-0000-00000000000b';
  const inserted = [];
  const store = Object.create(SupabaseStore.prototype);
  store.client = fakeClient(inserted);

  const task = await store.saveTask({ id: 't1', agent: 'sales', instruction: 'x', status: 'queued', created_at: new Date().toISOString(), workspace_id: WS }, { workspaceId: WS });
  assert.strictEqual(inserted[0].workspace_id, WS, 'task row stamped from task.workspace_id');
  assert.strictEqual(task.workspace_id, WS, 'returned task carries workspace_id');

  await store.saveTask({ id: 't2', agent: 'sales', instruction: 'x', status: 'queued', created_at: new Date().toISOString() }, { workspaceId: WS });
  assert.strictEqual(inserted[1].workspace_id, WS, 'task row stamped from options.workspaceId');

  await store.saveTask({ id: 't3', agent: 'telegram', instruction: 'x', status: 'done', created_at: new Date().toISOString() });
  assert.strictEqual(inserted[2].workspace_id, null, 'no workspace stays null');

  const msg = await store.addChatMessage({ role: 'user', content: 'hi', workspace_id: WS }, { workspaceId: WS });
  assert.strictEqual(inserted[3].workspace_id, WS, 'chat row stamped');
  assert.strictEqual(msg.workspace_id, WS);

  console.log('supabase-store-workspace-stamp: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
