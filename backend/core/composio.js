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

/**
 * Executes any Composio-connected tool action (Gmail, Slack, GitHub, etc.).
 *
 * @param {string} actionSlug - e.g. "GMAIL_SEND_EMAIL"
 * @param {object} args - action-specific arguments (see Composio's tool schema)
 * @param {string} toolkitSlug - e.g. "gmail" - used to resolve version and connected account.
 */
async function execute(actionSlug, args = {}, toolkitSlug) {
  const composio = getClient();
  try {
    const version = toolkitSlug ? await resolveLatestVersion(toolkitSlug) : undefined;
    const connectedAccountId = toolkitSlug ? await resolveConnectedAccountId(toolkitSlug) : null;

    const result = await composio.tools.execute(actionSlug, {
      userId: config.composio.userId,
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

module.exports = { execute, checkConnectionStatus };
