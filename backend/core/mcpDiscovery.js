// MCP discovery is a genuinely unsettled area as of this writing - several
// competing draft conventions exist, none of them a finalized standard. We
// try the ones that actually appear in circulation rather than picking one
// and hoping. A site implementing none of these is the common case, not a
// bug - this returns found:false correctly for the vast majority of sites.
const CANDIDATE_PATHS = [
  '/.well-known/mcp.json', // SEP-1649 (MCP server card) convention
  '/.well-known/mcp-server', // draft-serra-mcp-discovery-uri convention
  '/.well-known/mcp/index.json', // earlier /.well-known/mcp/ directory proposal
];

const DEFAULT_TIMEOUT_MS = 4000;

function originOf(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function checkPath(origin, path, timeoutMs) {
  const target = `${origin}${path}`;
  try {
    const res = await fetchWithTimeout(target, timeoutMs);
    if (!res.ok) return { path, target, status: res.status, ok: false };

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      return { path, target, status: res.status, ok: false, error: `unexpected content-type "${contentType}"` };
    }
    try {
      const manifest = await res.json();
      return { path, target, status: res.status, ok: true, manifest };
    } catch {
      return { path, target, status: res.status, ok: false, error: 'response was not valid JSON' };
    }
  } catch (err) {
    return { path, target, status: null, ok: false, error: err.name === 'AbortError' ? 'timed out' : err.message };
  }
}

/**
 * Checks a URL's origin against the known MCP discovery conventions.
 * Stops at the first successful match; reports every path it tried either
 * way so the caller can see what was actually checked, not just a verdict.
 */
async function checkForMCP(rawUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const origin = originOf(rawUrl);
  if (!origin) {
    return { url: rawUrl, origin: null, found: false, matchedPath: null, manifest: null, checkedPaths: [], error: 'not a valid http(s) URL' };
  }

  const checkedPaths = [];
  for (const path of CANDIDATE_PATHS) {
    const result = await checkPath(origin, path, timeoutMs);
    checkedPaths.push(result);
    if (result.ok) {
      return { url: rawUrl, origin, found: true, matchedPath: result.path, manifest: result.manifest, checkedPaths };
    }
  }
  return { url: rawUrl, origin, found: false, matchedPath: null, manifest: null, checkedPaths };
}

module.exports = { checkForMCP, CANDIDATE_PATHS };
