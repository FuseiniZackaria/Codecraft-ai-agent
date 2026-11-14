/**
 * helperBundle.js - builds the ONE-FILE Computer Helper a person downloads
 * from the "My computer" page and runs on their PC with `node`.
 *
 * It packs the exact safety modules the server uses (folder allowlist,
 * never-open file types, app allowlist, Recycle Bin only) plus helper/main.js
 * into a single script with no dependencies. `require('../../config')` inside
 * those modules gets a small stand-in filled from the helper's own settings
 * file, so the folder list always comes from the PC, never from the server.
 */

const fs = require('fs');
const path = require('path');

const MODULES = [
  'pathSafety', 'fileSearch', 'directoryInspect', 'openFile', 'openFolder',
  'largeFileAnalysis', 'oldFileAnalysis', 'duplicateDetection', 'recycleBin', 'appLaunch', 'ops',
];

function buildHelper({ serverUrl, pairCode = '' }) {
  if (!/^https?:\/\/[^\s"'`]+$/.test(String(serverUrl || ''))) throw new Error('Bad server address for the helper.');
  if (!/^[A-Z0-9-]{0,12}$/.test(String(pairCode || ''))) throw new Error('Bad connect code.');
  const defs = MODULES.map((name) => {
    const src = fs.readFileSync(path.join(__dirname, `${name}.js`), 'utf8');
    return `  './${name}': function (module, exports, require) {\n${src}\n  },`;
  }).join('\n');
  const main = fs.readFileSync(path.join(__dirname, 'helper', 'main.js'), 'utf8');

  return `#!/usr/bin/env node
// Codecraft Computer Helper. Run it with:  node codecraft-computer-helper.js
// Built ${new Date().toISOString()}. Needs Node.js 18+. No other installs needed.
// Options: --change-folders (pick folders/apps again), --forget (remove this PC's settings).
'use strict';
const __SERVER_URL = ${JSON.stringify(String(serverUrl).replace(/\/+$/, ''))};
const __PAIR_CODE = ${JSON.stringify(pairCode || '')};
const __config = { computerOperator: { allowedRoots: [], allowedApps: {}, maxSearchResults: 200, maxDeleteBatch: 20 } };
const __defs = {
${defs}
};
const __cache = {};
function __req(name) {
  if (name === '../../config') return __config;
  const key = name.replace(/\\.js$/, '');
  if (__defs[key]) {
    if (!__cache[key]) {
      const module = { exports: {} };
      __cache[key] = module;
      __defs[key](module, module.exports, __req);
    }
    return __cache[key].exports;
  }
  return require(name);
}

${main}

if (require.main === module && !process.env.CC_HELPER_NO_MAIN) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
} else {
  module.exports = { __req, __config, CONFIG_FILE };
}
`;
}

module.exports = { buildHelper, MODULES };
