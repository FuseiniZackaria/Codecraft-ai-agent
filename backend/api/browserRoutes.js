const express = require('express');
const config = require('../config');
const browserState = require('../core/browserState');
const mcpDiscovery = require('../core/mcpDiscovery');
const connectorDetections = require('../core/connectorDetections');
const cliDetection = require('../core/cliDetection');
const cliDetections = require('../core/cliDetections');
const cliImport = require('../core/cliImport');
const { SkillManager } = require('../core/installer/SkillManager');

const skillManager = new SkillManager();

const router = express.Router();

function requireToken(req, res, next) {
  const configured = config.browserExtension.token;
  if (!configured) {
    return res.status(503).json({
      error: 'BROWSER_EXTENSION_TOKEN is not set on the server - set it in .env before pairing the extension.',
    });
  }
  const provided = req.headers['x-codecraft-token'];
  if (provided !== configured) {
    return res.status(401).json({ error: 'Invalid or missing X-CodeCraft-Token header.' });
  }
  next();
}

router.use(requireToken);

/**
 * Fire-and-forget: an MCP check takes up to a few seconds across the
 * candidate paths, and the extension shouldn't feel laggy just because a
 * tab switch happened. Checked once per origin per server lifetime - not
 * once per page - so browsing five pages of the same site doesn't trigger
 * five checks.
 */
function triggerBackgroundMCPCheck(url) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  if (connectorDetections.has(origin)) return;
  connectorDetections.markChecking(origin);
  mcpDiscovery.checkForMCP(url).then(
    (result) => connectorDetections.record(origin, result),
    () => connectorDetections.record(origin, { found: false, matchedPath: null, manifest: null, error: 'check failed' })
  );
}

// Non-blocking, but - unlike the MCP check above - keyed by the FULL page
// URL, not just the origin. A site's MCP server is a single, site-wide
// capability, so checking once per origin is correct there. Page TEXT is
// not - two pages on the same site can say completely different things,
// so caching this by origin would silently reuse one page's result for
// every other page on the same site. Each distinct page gets its own scan.
function triggerBackgroundCLICheck(url) {
  if (cliDetections.has(url)) return;
  cliDetections.markChecking(url);
  cliDetection.scanForCLIMentions(url).then(
    (result) => cliDetections.record(url, result),
    () => cliDetections.record(url, { found: false, matches: [], error: 'check failed' })
  );
}

router.post('/visit', (req, res) => {
  const { url, title } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A string "url" field is required.' });
  }
  const entry = browserState.recordVisit({ url, title });
  res.json({ ok: true, recorded: entry });
  triggerBackgroundMCPCheck(url);
  triggerBackgroundCLICheck(url);
});

router.get('/current', (req, res) => {
  res.json({ current: browserState.getCurrent() });
});

router.get('/recent', (req, res) => {
  const limit = Number(req.query.limit) || undefined;
  res.json({ recent: browserState.getRecent(limit) });
});

router.get('/check-mcp', async (req, res) => {
  const targetUrl = req.query.url || (browserState.getCurrent() || {}).url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'No url provided and no current site recorded yet - visit a page with the extension paired first, or pass ?url=' });
  }
  const result = await mcpDiscovery.checkForMCP(targetUrl);
  res.json(result);
});

router.get('/check-cli', async (req, res) => {
  const targetUrl = req.query.url || (browserState.getCurrent() || {}).url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'No url provided and no current site recorded yet - visit a page with the extension paired first, or pass ?url=' });
  }
  const result = await cliDetection.scanForCLIMentions(targetUrl);
  res.json(result);
});

/**
 * Turns a page's own text into an installable guidance skill - NOT the
 * command itself being run. This never executes anything from the page;
 * it fetches the real text and saves it as reference content, through the
 * exact same install pipeline every other skill in this app goes through.
 */
router.post('/cli/import', async (req, res) => {
  const { url, command } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A string "url" field is required.' });
  }
  try {
    const { manifest, guidanceContent } = await cliImport.buildSkillFromPage(url, command);
    const packageDir = cliImport.writePackageToTempDir(manifest, guidanceContent);
    const result = await skillManager.installer.install(packageDir, { approvedPermissions: [] });
    res.json({ ok: true, skillId: result.skill.id, name: manifest.name, guidancePreviewChars: guidanceContent.length });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/detections', (req, res) => {
  res.json({ detections: connectorDetections.list(), cliDetections: cliDetections.list() });
});

/**
 * Single endpoint for the frontend to poll: "should I show a prompt right
 * now?" - combines the current site with whatever's known about its
 * origin, so the frontend doesn't have to cross-reference two calls itself.
 * cliDetection is reported separately and never folded into shouldPrompt -
 * it's a lower-confidence heuristic and shouldn't trigger the same banner
 * treatment as a verified MCP match.
 */
router.get('/prompt', (req, res) => {
  const currentSite = browserState.getCurrent();
  if (!currentSite) return res.json({ shouldPrompt: false, site: null, detection: null, cliDetection: null });

  let origin;
  try {
    origin = new URL(currentSite.url).origin;
  } catch {
    return res.json({ shouldPrompt: false, site: currentSite, detection: null, cliDetection: null });
  }

  const detection = connectorDetections.get(origin);
  const shouldPrompt = !!(detection && detection.found && !detection.checking);
  const cliResult = cliDetections.get(currentSite.url);
  const cliMentionFound = !!(cliResult && cliResult.found && !cliResult.checking);
  res.json({ shouldPrompt, site: currentSite, detection, cliMentionFound, cliDetection: cliResult });
});

module.exports = router;
