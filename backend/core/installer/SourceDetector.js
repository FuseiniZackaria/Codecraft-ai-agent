/**
 * SourceDetector - single responsibility: classify an install string into a
 * source descriptor. Doesn't fetch anything - Downloader does that.
 *
 * Handles every form from the spec:
 *   install marketing-agent                          -> registry
 *   install registry:marketing-agent                 -> registry
 *   install github:username/marketing-agent           -> github
 *   install https://github.com/user/marketing-agent   -> github
 *   install file://C:/Skills/marketing-agent           -> local
 *   install ./marketing-agent                          -> local
 *   install https://.../marketing-agent.zip             -> zip-url
 */
function detectSource(input) {
  const raw = input.trim();

  if (raw.startsWith('registry:')) {
    return { type: 'registry', id: raw.slice('registry:'.length) };
  }
  if (raw.startsWith('github:')) {
    return { type: 'github', repo: raw.slice('github:'.length) };
  }
  if (raw.startsWith('file://')) {
    return { type: 'local', path: raw.slice('file://'.length) };
  }
  if (/^https?:\/\/github\.com\//i.test(raw)) {
    const match = raw.match(/github\.com\/([^/]+\/[^/?#]+)/i);
    if (!match) throw new Error(`Could not parse GitHub URL: ${raw}`);
    return { type: 'github', repo: match[1].replace(/\.git$/, '') };
  }
  if (/^https?:\/\/.+\.zip($|\?)/i.test(raw)) {
    return { type: 'zip-url', url: raw };
  }
  if (/^https?:\/\//i.test(raw)) {
    return { type: 'zip-url', url: raw };
  }
  if (raw.startsWith('./') || raw.startsWith('../') || raw.startsWith('/') || /^[a-zA-Z]:\\/.test(raw)) {
    return { type: 'local', path: raw };
  }

  return { type: 'registry', id: raw };
}

module.exports = { detectSource };
