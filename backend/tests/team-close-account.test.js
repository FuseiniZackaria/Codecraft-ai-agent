// App owner "Close account": disable / re-enable / delete-with-backup.
// Uses an in-memory fake Supabase client that enforces the real foreign keys,
// so a wrong delete order fails the test the same way Postgres would.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.APP_OWNER_EMAIL = 'owner@example.com';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const OWNER = { id: 'u-owner', email: 'owner@example.com' };
const B = { id: 'u-b', email: 'dumenuian123@gmail.com' };
const WS_OWNER = 'ws-owner';
const WS_B = 'ws-b';

function makeFakeSupabase() {
  const users = new Map([
    [OWNER.id, { ...OWNER, created_at: '2026-01-01', last_sign_in_at: '2026-10-20', banned_until: null }],
    [B.id, { ...B, created_at: '2026-10-12', last_sign_in_at: '2026-10-21', banned_until: null }],
  ]);
  const db = {
    workspaces: [{ id: WS_OWNER, owner_user_id: OWNER.id, name: 'Owner' }, { id: WS_B, owner_user_id: B.id, name: "B's workspace" }],
    workspace_members: [{ workspace_id: WS_OWNER, user_id: OWNER.id, role: 'owner' }, { workspace_id: WS_B, user_id: B.id, role: 'owner' }],
    user_roles: [{ user_id: OWNER.id, role_id: 'r-admin' }, { user_id: B.id, role_id: 'r-admin' }],
    workspace_connections: [
      { workspace_id: WS_B, provider: 'telegram', provider_meta: { encrypted_token: { enc: 'x' }, webhook_token: 'w', bot_username: 'b_bot' } },
      { workspace_id: WS_OWNER, provider: 'gmail', composio_account_id: 'ca_owner', provider_meta: {} },
    ],
    business_profile: [{ workspace_id: WS_B, display_name: 'B Co' }, { workspace_id: WS_OWNER, display_name: 'Owner Co' }],
    tasks: [{ id: 't-b', workspace_id: WS_B }, { id: 't-owner', workspace_id: WS_OWNER }],
    reflections: [{ id: 'r-b', task_id: 't-b', workspace_id: WS_B }],
    chat_messages: [{ id: 'c-b', workspace_id: WS_B, content: 'hi' }],
    audit_log: [{ id: 'a-b', workspace_id: WS_B }],
    conversations: [{ id: 'conv-b', user_id: B.id }],
    messages: [{ id: 'm-b', conversation_id: 'conv-b' }],
  };
  const deletes = [];

  // Foreign keys that RESTRICT (no cascade) - checked on every delete.
  function fkViolation(table, removed) {
    const ids = (col) => new Set(removed.map((r) => r[col]));
    if (table === 'tasks' && db.reflections.some((r) => ids('id').has(r.task_id))) return 'reflections.task_id -> tasks';
    if (table === 'workspaces') {
      const ws = ids('id');
      for (const [t, rows] of Object.entries(db)) {
        if (t === 'workspaces' || t === 'conversations' || t === 'messages' || t === 'user_roles') continue;
        if (rows.some((r) => ws.has(r.workspace_id))) return `${t}.workspace_id -> workspaces`;
      }
    }
    if (table === 'conversations' && db.messages.some((m) => ids('id').has(m.conversation_id))) return 'messages.conversation_id -> conversations';
    return null;
  }

  function query(table) {
    const filters = [];
    let mode = 'select';
    const rows = () => (db[table] || []).filter((r) => filters.every(([c, v]) => r[c] === v));
    const run = () => {
      if (!db[table]) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
      if (mode === 'delete') {
        const removed = rows();
        const v = fkViolation(table, removed);
        if (v) return { data: null, error: { message: `violates foreign key constraint (${v})` } };
        db[table] = db[table].filter((r) => !removed.includes(r));
        if (removed.length) deletes.push(table);
        return { data: null, error: null };
      }
      return { data: rows().map((r) => ({ ...r })), error: null };
    };
    const q = {
      select() { return q; },
      delete() { mode = 'delete'; return q; },
      eq(c, v) { filters.push([c, v]); return q; },
      order() { return q; },
      async maybeSingle() { const r = run(); return { data: r.data ? r.data[0] || null : null, error: r.error }; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return q;
  }

  const invites = [];
  return {
    db, users, deletes, invites,
    from: query,
    auth: {
      admin: {
        async getUserById(id) { const u = users.get(id); return u ? { data: { user: { ...u } }, error: null } : { data: null, error: { message: 'not found' } }; },
        async updateUserById(id, attrs) {
          const u = users.get(id);
          if (!u) return { error: { message: 'not found' } };
          if (attrs.ban_duration === 'none') u.banned_until = null;
          else if (attrs.ban_duration) u.banned_until = new Date(Date.now() + 876000 * 3600 * 1000).toISOString();
          if (attrs.user_metadata) u.user_metadata = attrs.user_metadata;
          return { data: { user: u }, error: null };
        },
        async inviteUserByEmail(email, options) {
          invites.push({ email, options });
          return { data: { user: { id: `u-${email}`, email } }, error: null };
        },
        async deleteUser(id) {
          if (db.workspaces.some((w) => w.owner_user_id === id)) return { error: { message: 'workspaces.owner_user_id restricts delete' } };
          if (db.user_roles.some((r) => r.user_id === id)) return { error: { message: 'user_roles.user_id restricts delete' } };
          if (db.conversations.some((c) => c.user_id === id)) return { error: { message: 'conversations.user_id restricts delete' } };
          users.delete(id);
          db.workspace_members = db.workspace_members.filter((m) => m.user_id !== id); // ON DELETE CASCADE
          return { error: null };
        },
        async listUsers() { return { data: { users: [...users.values()] }, error: null }; },
      },
    },
  };
}

async function main() {
  const accountClosure = require('../core/accountClosure');
  const teamRoutes = require('../api/teamRoutes');
  const sb = makeFakeSupabase();
  teamRoutes._setSupabaseForTests(sb);

  let user = { ...OWNER, workspaceId: WS_OWNER, workspaceRole: 'owner' };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/team', teamRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/team`;
  const post = async (p, body) => {
    const res = await fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return { status: res.status, body: await res.json() };
  };

  try {
    // --- Invites end on "Create your password" ---
    sb.users.set('u-p', { id: 'u-p', email: 'pending@example.com', last_sign_in_at: null, user_metadata: { invited: true } });
    const res = await fetch(`${base}/resend/u-p`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.example' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(sb.invites[0].options.redirectTo, 'https://app.example/set-password', 'invite link lands on the set-password page');
    assert.strictEqual(sb.invites[0].options.data.needs_password, true, 'invite marks the account as needing a password');
    assert.strictEqual(sb.users.get('u-p').user_metadata.needs_password, true, 'older invitees get the flag on resend');
    assert.strictEqual(sb.users.get('u-p').user_metadata.invited, true, 'existing metadata is kept');
    sb.users.delete('u-p');
    console.log('✓ invites mark the account "needs password" and link to the set-password page');

    // --- Guards ---
    let r = await post(`/close/${B.id}`, { action: 'disable', confirmEmail: 'wrong@example.com' });
    assert.strictEqual(r.status, 400, 'the typed email must match');
    r = await post(`/close/${OWNER.id}`, { action: 'disable', confirmEmail: OWNER.email });
    assert.strictEqual(r.status, 400, 'the app owner can never close their own account');
    user = { ...B, workspaceId: WS_B, workspaceRole: 'owner' };
    r = await post(`/close/${OWNER.id}`, { action: 'delete', confirmEmail: OWNER.email });
    assert.strictEqual(r.status, 403, 'only the app owner can close accounts');
    user = { ...OWNER, workspaceId: WS_OWNER, workspaceRole: 'owner' };
    console.log('✓ guards: typed email must match, own account refused, non-app-owner refused');

    // --- Disable (default) keeps all data and blocks sign-in ---
    r = await post(`/close/${B.id}`, { confirmEmail: 'DUMENUIAN123@gmail.com' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.action, 'disabled', 'disable is the default action');
    assert.ok(accountClosure.isDisabled(sb.users.get(B.id)), 'the account is banned');
    assert.strictEqual(sb.db.workspaces.length, 2, 'no data is deleted when disabling');
    assert.strictEqual(sb.deletes.length, 0);
    console.log('✓ disable: account cannot sign in, all data kept');

    // --- Re-enable ---
    r = await post(`/enable/${B.id}`);
    assert.strictEqual(r.status, 200);
    assert.ok(!accountClosure.isDisabled(sb.users.get(B.id)), 'the account can sign in again');
    console.log('✓ re-enable: the account can sign in again');

    // --- Delete: backup first, then everything in FK order; owner untouched ---
    r = await post(`/close/${B.id}`, { action: 'delete', confirmEmail: B.email });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.action, 'deleted');

    const backup = r.body.backup;
    const wsBackup = backup.workspaces[0];
    assert.strictEqual(wsBackup.workspace.id, WS_B);
    assert.strictEqual(wsBackup.tables.tasks.length, 1);
    assert.strictEqual(wsBackup.tables.reflections.length, 1);
    assert.strictEqual(wsBackup.tables.chat_messages[0].content, 'hi');
    assert.strictEqual(wsBackup.tables.business_profile[0].display_name, 'B Co');
    const conn = wsBackup.tables.workspace_connections[0];
    assert.strictEqual(conn.provider_meta.bot_username, 'b_bot');
    assert.ok(!('encrypted_token' in conn.provider_meta) && !('webhook_token' in conn.provider_meta), 'secrets are stripped from the backup');
    assert.ok(r.body.backupFile, 'the backup is also saved on the server');
    const backupPath = path.join(__dirname, '..', 'data', 'backups', r.body.backupFile);
    assert.ok(fs.existsSync(backupPath));
    fs.unlinkSync(backupPath);
    console.log('✓ delete: a full JSON backup (secrets stripped) is made first');

    assert.ok(!sb.users.has(B.id), 'auth user deleted');
    assert.ok(!sb.db.workspaces.some((w) => w.id === WS_B), 'workspace deleted');
    for (const t of ['tasks', 'reflections', 'chat_messages', 'audit_log', 'workspace_connections', 'business_profile', 'workspace_members']) {
      assert.ok(!sb.db[t].some((row) => row.workspace_id === WS_B), `${t} rows for B deleted`);
    }
    assert.ok(!sb.db.user_roles.some((x) => x.user_id === B.id), 'admin role removed');
    assert.ok(!sb.db.conversations.some((c) => c.user_id === B.id) && sb.db.messages.length === 0, 'conversations removed');
    assert.ok(sb.deletes.indexOf('reflections') < sb.deletes.indexOf('tasks'), 'reflections before tasks');
    for (const child of ['tasks', 'chat_messages', 'workspace_connections', 'business_profile', 'workspace_members']) {
      assert.ok(sb.deletes.indexOf(child) < sb.deletes.indexOf('workspaces'), ` deleted before workspaces`);
    }
    console.log('✓ delete: connections, data, membership, profile, roles and login removed in foreign-key order');

    assert.ok(sb.users.has(OWNER.id), 'the owner account is untouched');
    assert.ok(sb.db.workspaces.some((w) => w.id === WS_OWNER));
    assert.ok(sb.db.tasks.some((t) => t.id === 't-owner'));
    assert.ok(sb.db.workspace_connections.some((c) => c.workspace_id === WS_OWNER));
    assert.ok(sb.db.business_profile.some((p) => p.workspace_id === WS_OWNER));
    console.log('✓ delete: the app owner\'s workspace and data are never touched');

    // A team member of the owner's own workspace can't be closed this way.
    sb.users.set('u-m', { id: 'u-m', email: 'member@example.com', banned_until: null });
    sb.db.workspace_members.push({ workspace_id: WS_OWNER, user_id: 'u-m', role: 'member' });
    r = await post('/close/u-m', { action: 'delete', confirmEmail: 'member@example.com' });
    assert.strictEqual(r.status, 400, 'accounts in the owner\'s own workspace are refused');
    console.log('✓ accounts in your own workspace are refused (use Remove instead)');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\nAll close-account checks passed.');
}

main().catch((err) => {
  console.error('✗ team-close-account.test.js failed:', err);
  process.exit(1);
});
