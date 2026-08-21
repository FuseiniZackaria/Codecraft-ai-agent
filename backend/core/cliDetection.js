// Unlike MCP, there is no structural signal a website can expose for "I
// have a CLI" - no well-known URI, nothing to knock on. The only real
// signal available is that a page's own text often mentions the install
// command directly (exactly how the mdskills.ai page worked earlier in
// this project). So this is a genuine heuristic: pattern-matching visible
// page text for common install-command shapes. It WILL have false
// positives (a blog post discussing npm as a topic, not instructing an
// install) and false negatives (a real CLI whose install command is an
// image, or phrased unusually). Every result this module returns should
// be treated as "mentioned on this page", not "verified" the way an MCP
// match is.

// A single, consistent character class for every argument position in
// every pattern below. The original bug: npx's first word allowed "/" but
// its REPEATED word-groups didn't, so "npx mdskills install
// nextlevelbuilder/ui-ux-pro-max" - where the "/" is in the third word,
// not the first - got silently truncated to "...nextlevelbuilder". Same
// risk existed in a couple of the single-arg patterns below (a brew tap
// like "user/tap/formula" has the same shape), so every pattern uses this
// one class everywhere, not just in the first position.
const ARG = '[\\w@/.-]+';

const PATTERNS = [
  { name: 'npx', regex: new RegExp(`\\bnpx\\s+${ARG}(?:\\s+${ARG}){0,3}`, 'g') },
  { name: 'npm install -g', regex: new RegExp(`\\bnpm\\s+install\\s+-g\\s+${ARG}`, 'g') },
  { name: 'pip install', regex: new RegExp(`\\bpip3?\\s+install\\s+${ARG}`, 'g') },
  { name: 'cargo install', regex: new RegExp(`\\bcargo\\s+install\\s+${ARG}`, 'g') },
  { name: 'go install', regex: new RegExp(`\\bgo\\s+install\\s+${ARG}`, 'g') },
  { name: 'brew install', regex: new RegExp(`\\bbrew\\s+install\\s+${ARG}`, 'g') },
  { name: 'yarn global add', regex: new RegExp(`\\byarn\\s+global\\s+add\\s+${ARG}`, 'g') },
];

const MAX_MATCHES = 5;
const MAX_BYTES_TO_SCAN = 500_000; // don't try to regex-scan an enormous page
const DEFAULT_TIMEOUT_MS = 5000;

function stripTagsAndDecode(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

async function scanForCLIMentions(rawUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let origin;
  try {
    origin = new URL(rawUrl).origin;
  } catch {
    return { url: rawUrl, found: false, matches: [], error: 'not a valid http(s) URL' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      return { url: rawUrl, origin, found: false, matches: [], error: `HTTP ${res.status}` };
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html')) {
      return { url: rawUrl, origin, found: false, matches: [], error: `not an HTML page (content-type "${contentType}")` };
    }

    let html = await res.text();
    if (html.length > MAX_BYTES_TO_SCAN) html = html.slice(0, MAX_BYTES_TO_SCAN);
    const text = stripTagsAndDecode(html);

    const matches = [];
    for (const { name, regex } of PATTERNS) {
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(text)) && matches.length < MAX_MATCHES) {
        matches.push({ pattern: name, command: m[0].trim().replace(/\s+/g, ' ') });
      }
    }

    return { url: rawUrl, origin, found: matches.length > 0, matches };
  } catch (err) {
    return { url: rawUrl, origin, found: false, matches: [], error: err.name === 'AbortError' ? 'timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { scanForCLIMentions, PATTERNS };
