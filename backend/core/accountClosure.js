/**
 * App-owner "Close account" for other workspaces: disable (reversible) or
 * delete the account and its workspace (after a JSON backup).
 *
 * Every function takes the Supabase service client as its first argument so
 * the logic can be tested with a fake client.
 */

// Effectively permanent until re-enabled (~100 years).
const BAN_DURATION = '876000h';

// Workspace-scoped tables, children before parents so foreign keys are
// respected: reflections -> tasks, workflow_runs -> workflow_definitions,
// briefing_articles -> briefing_runs, chat/outreach rows may point at tasks.
// Every one of them references workspaces(id), so all go before `workspaces`.
const WORKSPACE_TABLES = [
  'reflections',
  'chat_messages',
  'outreach_threads',
  'workflow_runs',
  'briefing_articles',
  'briefing_runs',
  'tasks',
  'audit_log',
  'agent_memory',
  'long_term_memory',
  'scheduled_workflows',
  'workflow_definitions',
  'skills',
  'assistant_usage_daily',
  'workspace_connections',
  'business_profile',
  'workspace_members',
];

function isMissingTable(error) {
  const msg = String(error?.message || '');
  return error?.code === '42P01' || /does not exist|could not find the table/i.test(msg);
}

function isDisabled(user, now = Date.now()) {
  return !!(user?.banned_until && new Date(user.banned_until).getTime() > now);
}

async function disableAccount(sb, userId) {
  const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION });
  if (error) throw new Error(`Failed to disable account: ${error.message}`);
}

async function enableAccount(sb, userId) {
  const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  if (error) throw new Error(`Failed to re-enable account: ${error.message}`);
}

// Encrypted bot tokens / API keys are useless outside this server and must not
// leave it in a downloadable file.
function stripSecrets(row) {
  if (!row?.provider_meta) return row;
  const meta = {};
  for (const [k, v] of Object.entries(row.provider_meta)) {
    if (/^encrypted_|token|secret/i.test(k)) continue;
    meta[k] = v;
  }
  return { ...row, provider_meta: meta };
}

/** Full JSON backup of one workspace (every workspace-scoped table + the workspace row). */
async function exportWorkspace(sb, workspaceId, { user = null } = {}) {
  const backup = {
    exportedAt: new Date().toISOString(),
    workspaceId,
    user: user ? { id: user.id, email: user.email, created_at: user.created_at } : null,
    workspace: null,
    tables: {},
    skippedTables: [],
  };
  const { data: ws, error: wsError } = await sb.from('workspaces').select('*').eq('id', workspaceId).maybeSingle();
  if (wsError) throw new Error(`Backup failed reading workspaces: ${wsError.message}`);
  backup.workspace = ws || null;

  for (const table of WORKSPACE_TABLES) {
    const { data, error } = await sb.from(table).select('*').eq('workspace_id', workspaceId);
    if (error) {
      if (isMissingTable(error)) { backup.skippedTables.push(table); continue; }
      throw new Error(`Backup failed reading ${table}: ${error.message}`);
    }
    backup.tables[table] = table === 'workspace_connections' ? (data || []).map(stripSecrets) : (data || []);
  }
  return backup;
}

async function deleteWhere(sb, table, column, value) {
  const { error } = await sb.from(table).delete().eq(column, value);
  if (error && !isMissingTable(error)) throw new Error(`Failed to delete from ${table}: ${error.message}`);
}

/**
 * Deletes the given workspaces' data, the workspaces, the user's roles/membership and
 * the auth user, in foreign-key order. Call exportWorkspace() first.
 */
async function deleteAccountAndWorkspace(sb, { userId, workspaceIds = [] }) {
  for (const workspaceId of workspaceIds) {
    for (const table of WORKSPACE_TABLES) await deleteWhere(sb, table, 'workspace_id', workspaceId);
    await deleteWhere(sb, 'workspaces', 'id', workspaceId);
  }

  // Rows that point at the auth user without ON DELETE CASCADE.
  await deleteWhere(sb, 'workspace_members', 'user_id', userId);
  await deleteWhere(sb, 'user_roles', 'user_id', userId);
  const { data: convs, error: convError } = await sb.from('conversations').select('id').eq('user_id', userId);
  if (convError && !isMissingTable(convError)) throw new Error(`Failed to read conversations: ${convError.message}`);
  for (const c of convs || []) await deleteWhere(sb, 'messages', 'conversation_id', c.id);
  await deleteWhere(sb, 'conversations', 'user_id', userId);

  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) throw new Error(`Failed to delete auth user: ${error.message}`);
}

module.exports = {
  WORKSPACE_TABLES,
  isDisabled,
  disableAccount,
  enableAccount,
  exportWorkspace,
  deleteAccountAndWorkspace,
};
