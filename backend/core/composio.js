const { Composio } = require('@composio/core');
const config = require('../config');

let client;
const versionCache = new Map(); // toolkitSlug -> resolved version string
const accountCache = new Map(); // toolkitSlug -> resolved connectedAccountId

function getClient() {
  if (!config.composio.apiKey) {
    throw new Error('COMPOSIO_API_KEY not configured - set it in .env');
  }
  if (!client) {
    client = new Composio({ apiKey: config.composio.apiKey });
  }
  return client;
}

/**
 * Resolves "latest" to an actual dated version string (e.g. "20251027_00")
 * by asking Composio directly, and caches it. The execute() endpoint rejects
 * the literal word "latest" - only toolkits.get() reliably exposes real
 * version identifiers (toolkit.meta.availableVersions[0]).
 */
async function resolveLatestVersion(toolkitSlug) {
  if (versionCache.has(toolkitSlug)) return versionCache.get(toolkitSlug);

  const composio = getClient();
  const toolkit = await composio.toolkits.get(toolkitSlug);
  const latest = toolkit?.meta?.availableVersions?.[0];
  if (!latest) {
    throw new Error(`Could not resolve latest version for toolkit "${toolkitSlug}"`);
  }
  versionCache.set(toolkitSlug, latest);
  return latest;
}

/**
 * Resolves which connected account to use for a toolkit, so you don't have
 * to manually find and paste a Connected Account ID into .env every time
 * you connect a new service.
 *
 * - An explicit COMPOSIO_<TOOLKIT>_CONNECTED_ACCOUNT_ID in .env always wins,
 *   for cases where you genuinely have more than one account connected for
 *   the same service and need to pin a specific one.
 * - Otherwise, auto-resolves by looking up the toolkit's connected accounts
 *   directly: exactly one ACTIVE account -> use it, no config needed at
 *   all. Zero or multiple ACTIVE accounts -> a clear, specific error
 *   telling you exactly what to do, rather than a silent wrong guess.
 */
async function resolveConnectedAccountId(toolkitSlug) {
  const pinned = config.composio.connectedAccountIds?.[toolkitSlug];
  if (pinned) return pinned;

  if (accountCache.has(toolkitSlug)) return accountCache.get(toolkitSlug);

  const res = await fetch(`https://backend.composio.dev/api/v3/connected_accounts?toolkit_slug=${toolkitSlug}`, {
    headers: { 'x-api-key': config.composio.apiKey },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Could not look up connected accounts for "${toolkitSlug}": ${json?.error?.message || `HTTP ${res.status}`}`);
  }

  // Defense in depth: don't just trust the ?toolkit_slug= query param to
  // have filtered correctly - verify each returned item is actually for
  // this toolkit. This was a real bug: without this check, accounts from
  // OTHER services (Gmail, WhatsApp) showed up in a "github" lookup.
  const active = (json.items || []).filter(
    (a) => a.status === 'ACTIVE' && a.toolkit?.slug?.toLowerCase() === toolkitSlug.toLowerCase()
  );
  if (active.length === 0) {
    throw new Error(`No active "${toolkitSlug}" connection found - connect it in the Composio dashboard first.`);
  }
  if (active.length > 1) {
    const envVar = `COMPOSIO_${toolkitSlug.toUpperCase()}_CONNECTED_ACCOUNT_ID`;
    throw new Error(
      `Multiple active "${toolkitSlug}" connections found (${active.map((a) => a.id).join(', ')}) - ` +
      `set ${envVar} in .env to pick which one to use.`
    );
  }

  accountCache.set(toolkitSlug, active[0].id);
  return active[0].id;
}

// Toolkits that can be connected per workspace (rows in workspace_connections,
// provider name == toolkit slug). Every other toolkit (youtube, reddit, ...) only
// has the server's single legacy account, so it is owner-workspace only.
const PER_WORKSPACE_TOOLKITS = new Set(['gmail', 'googlecalendar', 'github']);

const TOOLKIT_LABELS = { gmail: 'Gmail', googlecalendar: 'Google Calendar', github: 'GitHub' };

class WorkspaceConnectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkspaceConnectionError';
    this.code = 'WORKSPACE_CONNECTION_MISSING';
  }
}

async function isOwnerWorkspace(workspaceId) {
  const ownerWs = await require('./workspaceContext').getAppOwnerWorkspaceId();
  return !!ownerWs && ownerWs === workspaceId;
}

/** The Composio user ("entity") that owns a workspace's own connections. Unique per workspace. */
function entityFor(workspaceId) {
  return `ws_${workspaceId}`;
}

/**
 * A stored connection row is trusted only if it provably belongs to this
 * workspace: its Composio user is the workspace's own entity. The owner
 * workspace may also hold the server's legacy account (its pre-workspace
 * connection, mapped to the owner workspace only). Anything else - e.g. a row
 * the old connect flow "adopted" from another workspace's account - is stale.
 */
function isVerifiedConnection(workspaceId, conn, { owner = false } = {}) {
  if (!conn || conn.status !== 'connected' || !conn.composio_account_id) return false;
  const user = conn.provider_meta?.composio_user_id;
  if (user === entityFor(workspaceId)) return true;
  return owner && user === config.composio.userId;
}

/**
 * Decides which Composio user + connected account a call runs as.
 *
 * - No workspaceId (scheduler / webhook background jobs of the single-tenant
 *   install): the server's legacy account, as before.
 * - A workspace with a verified connection of its own: that account only.
 * - The app owner's workspace with no row yet: the legacy account, which is
 *   mapped to the owner workspace only.
 * - Any other workspace: refuse ("Connect Gmail first"). Never the .env ids,
 *   never another workspace's connection.
 */
async function resolveTarget(workspaceId, toolkitSlug) {
  const legacy = async () => ({
    userId: config.composio.userId,
    connectedAccountId: toolkitSlug ? await resolveConnectedAccountId(toolkitSlug) : null,
  });
  if (!workspaceId || !toolkitSlug) return legacy();

  let owner = await isOwnerWorkspace(workspaceId);

  if (PER_WORKSPACE_TOOLKITS.has(toolkitSlug)) {
    const conn = await require('./workspaceConnections').getConnection(workspaceId, toolkitSlug);
    if (isVerifiedConnection(workspaceId, conn, { owner })) {
      return { connectedAccountId: conn.composio_account_id, userId: conn.provider_meta.composio_user_id };
    }
    // The owner disconnected the legacy account (e.g. its token expired) and
    // must reconnect - don't silently fall back to it again.
    if (conn?.provider_meta?.legacy_dismissed) owner = false;
  }

  if (owner) return legacy();

  const label = TOOLKIT_LABELS[toolkitSlug] || toolkitSlug;
  throw new WorkspaceConnectionError(
    PER_WORKSPACE_TOOLKITS.has(toolkitSlug)
      ? `Connect ${label} first - this workspace has no ${label} connection of its own.`
      : `${label} is not available for this workspace.`
  );
}

/**
 * Executes any Composio-connected tool action (Gmail, Slack, GitHub, etc.).
 *
 * @param {string} actionSlug - e.g. "GMAIL_SEND_EMAIL"
 * @param {object} args - action-specific arguments (see Composio's tool schema)
 * @param {string} toolkitSlug - e.g. "gmail" - used to resolve version and connected account.
 * @param {object} [opts] - { workspaceId } the workspace the call runs for; see resolveTarget().
 */
async function execute(actionSlug, args = {}, toolkitSlug, opts = {}) {
  // sendGuard: in test mode, refuse real sends unless ALLOW_REAL_SENDS=1.
  // Read-only actions (GMAIL_FETCH_EMAILS, GMAIL_GET_THREAD, YOUTUBE_SEARCH,
  // etc.) pass through so integration tests of read paths keep working.
  require('./sendGuard').assertComposioActionAllowed(actionSlug);
  const composio = getClient();
  try {
    // Resolved before the version lookup so a missing workspace connection
    // fails fast with its own clear message.
    const { userId, connectedAccountId } = opts.target || await resolveTarget(opts.workspaceId || null, toolkitSlug);
    const version = toolkitSlug ? await resolveLatestVersion(toolkitSlug) : undefined;

    const result = await composio.tools.execute(actionSlug, {
      userId,
      ...(connectedAccountId ? { connectedAccountId } : {}),
      arguments: args,
      ...(version ? { version } : {}),
    });
    if (result?.successful === false) {
      const detail = result?.error?.message || result?.error || JSON.stringify(result).slice(0, 500);
      throw new Error(detail);
    }
    return result?.data ?? result;
  } catch (err) {
    if (err instanceof WorkspaceConnectionError) throw err; // already a clear, user-facing message
    console.error(`[composio] ${actionSlug} raw error:`, err);
    const detailParts = [err.message];
    if (err.cause) detailParts.push(`cause: ${err.cause.message || JSON.stringify(err.cause)}`);
    if (err.response?.data) detailParts.push(`response: ${JSON.stringify(err.response.data)}`);
    if (err.body) detailParts.push(`body: ${JSON.stringify(err.body)}`);
    throw new Error(`Composio ${actionSlug} failed: ${detailParts.join(' | ')}`);
  }
}

/**
 * Checks whether a toolkit has an ACTIVE connected account, by querying
 * Composio's connected_accounts endpoint directly rather than guessing at
 * some "safe" read-only tool to execute (which has been unreliable before -
 * wrong slugs, expired tokens, etc. all produce confusing execution errors
 * instead of a clean status answer).
 */
async function checkConnectionStatus(toolkitSlug) {
  if (!config.composio.apiKey) {
    return { connected: false, error: 'COMPOSIO_API_KEY not configured' };
  }
  try {
    await resolveConnectedAccountId(toolkitSlug);
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

/**
 * Stages a local file with Composio so it can be referenced in a tool call
 * (e.g. video upload). Composio genuinely requires this two-step dance for
 * file-accepting tools - confirmed for real, since this exact requirement
 * surfaced as a live SDK warning earlier in this project for Gmail's
 * attachment field. The general shape is documented as
 * composio.files.upload({ file, toolSlug, toolkitSlug }) - whether `file`
 * wants a path string, Buffer, or stream isn't fully confirmed; this passes
 * the raw path first, the more common convenience shape for upload helpers.
 */
async function uploadFile(filePath, actionSlug, toolkitSlug) {
  // Every uploadFile call stages content for a subsequent send/upload
  // action - treat the staging step itself as a send for guard purposes.
  require('./sendGuard').assertRealSendsAllowed(`Composio file upload for ${actionSlug}`);
  const composio = getClient();
  try {
    return await composio.files.upload({ file: filePath, toolSlug: actionSlug, toolkitSlug });
  } catch (err) {
    throw new Error(`Composio file upload failed: ${err.message}`);
  }
}

const authConfigCache = new Map(); // toolkitSlug -> Composio-managed auth config id

async function getManagedAuthConfigId(toolkitSlug) {
  if (authConfigCache.has(toolkitSlug)) return authConfigCache.get(toolkitSlug);
  const composio = getClient();
  const existing = await composio.authConfigs.list({ toolkit: toolkitSlug, isComposioManaged: true });
  let id = existing?.items?.[0]?.id;
  if (!id) {
    const created = await composio.authConfigs.create(toolkitSlug, { type: 'use_composio_managed_auth' });
    id = created?.id;
  }
  if (!id) throw new Error(`Could not find or create a Composio-managed auth config for "${toolkitSlug}"`);
  authConfigCache.set(toolkitSlug, id);
  return id;
}

/**
 * Starts a fresh hosted sign-in (OAuth) for one workspace. The connected
 * account is created under that workspace's own entity ("ws_<id>"), so it can
 * never be confused with any other workspace's account. Never adopts an
 * existing account. (Uses connectedAccounts.link(); the older REST initiate
 * endpoint is retired for Composio-managed OAuth.)
 */
async function startWorkspaceConnection(workspaceId, toolkitSlug, callbackUrl) {
  if (!workspaceId) throw new Error('workspaceId is required');
  if (!PER_WORKSPACE_TOOLKITS.has(toolkitSlug)) throw new Error(`"${toolkitSlug}" cannot be connected per workspace`);
  const composio = getClient();
  const authConfigId = await getManagedAuthConfigId(toolkitSlug);
  const request = await composio.connectedAccounts.link(
    entityFor(workspaceId),
    authConfigId,
    callbackUrl ? { callbackUrl } : undefined
  );
  return { redirectUrl: request.redirectUrl || null, connectionId: request.id || null };
}

/**
 * Finds an ACTIVE connected account owned by this workspace's own entity.
 * Never looks at accounts of any other Composio user, and a caller-supplied
 * connectionId is only accepted if it is one of those accounts - a workspace
 * cannot claim somebody else's connection by guessing its id.
 */
async function findWorkspaceAccount(workspaceId, toolkitSlug, connectionId = null) {
  if (!workspaceId) throw new Error('workspaceId is required');
  const entity = entityFor(workspaceId);
  const composio = getClient();
  const res = await composio.connectedAccounts.list({
    userIds: [entity],
    toolkitSlugs: [toolkitSlug],
    statuses: ['ACTIVE'],
  });
  // Defense in depth: re-check the fields the query filtered on. List items
  // from the SDK don't carry a user id, so the userIds filter above is what
  // scopes the result; if an item ever does report an owner, it must match.
  const mine = (res?.items || []).filter((a) => {
    if (a.status !== 'ACTIVE') return false;
    if (a.toolkit?.slug?.toLowerCase() !== toolkitSlug.toLowerCase()) return false;
    const owner = a.userId ?? a.user_id;
    return !owner || owner === entity;
  });
  const match = connectionId ? mine.find((a) => a.id === connectionId) : mine[0];
  if (!match) return null;
  return { id: match.id, userId: entity };
}

/** The server's legacy (.env / single-account) connection. Mapped to the owner workspace only. */
async function findLegacyAccount(toolkitSlug) {
  try {
    const id = await resolveConnectedAccountId(toolkitSlug);
    // A pinned .env id is returned without a status check; skip it if Composio
    // reports it as no longer ACTIVE (expired / revoked).
    const detail = await getClient().connectedAccounts?.get?.(id);
    if (detail && detail.status && detail.status !== 'ACTIVE') return null;
    return { id, userId: config.composio.userId };
  } catch {
    return null;
  }
}

// Read-only "who is this account" actions, used to show the address/username
// on the Connections card. Best effort: an unknown slug or shape just yields null.
const IDENTITY_ACTIONS = {
  gmail: { slug: 'GMAIL_GET_PROFILE', args: { user_id: 'me' }, pick: (d) => d?.emailAddress || d?.response_data?.emailAddress },
  googlecalendar: { slug: 'GOOGLECALENDAR_GET_CALENDAR', args: { calendar_id: 'primary' }, pick: (d) => d?.id || d?.calendar_data?.id },
  github: { slug: 'GITHUB_GET_THE_AUTHENTICATED_USER', args: {}, pick: (d) => d?.login || d?.details?.login },
};

async function fetchAccountIdentity(toolkitSlug, account) {
  const spec = IDENTITY_ACTIONS[toolkitSlug];
  if (!spec || !account?.id) return null;
  try {
    const data = await execute(spec.slug, spec.args, toolkitSlug, {
      target: { userId: account.userId, connectedAccountId: account.id },
    });
    return spec.pick(data) || null;
  } catch {
    return null;
  }
}

/**
 * Revokes a workspace's own connected account at Composio. Only ever touches
 * an account under that workspace's entity - never the legacy/owner account
 * and never another workspace's.
 */
async function revokeWorkspaceAccount(workspaceId, conn) {
  if (!conn?.composio_account_id) return false;
  if (conn.provider_meta?.composio_user_id !== entityFor(workspaceId)) return false;
  try {
    await getClient().connectedAccounts.delete(conn.composio_account_id);
    return true;
  } catch (err) {
    console.warn(`[composio] could not revoke ${conn.composio_account_id}: ${err.message}`);
    return false;
  }
}
/** Test hook: swap the SDK client and clear caches. */
function _resetForTests(fakeClient = null) {
  client = fakeClient;
  versionCache.clear();
  accountCache.clear();
  authConfigCache.clear();
}

module.exports = {
  execute,
  checkConnectionStatus,
  uploadFile,
  startWorkspaceConnection,
  findWorkspaceAccount,
  findLegacyAccount,
  fetchAccountIdentity,
  revokeWorkspaceAccount,
  isVerifiedConnection,
  isOwnerWorkspace,
  entityFor,
  WorkspaceConnectionError,
  PER_WORKSPACE_TOOLKITS,
  _resetForTests,
};
