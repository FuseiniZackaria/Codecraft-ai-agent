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
// Options: --change-folders (pick folders again), --advanced (also apps it may start), --forget (remove this PC's settings).
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

// Non-ASCII characters become \uXXXX escapes (valid anywhere in JS source), so
// the script survives being carried inside a Windows .cmd file unchanged.
const asciiOnly = (s) => s.replace(/[^\x00-\x7F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * The same helper wrapped in a Windows file people just DOUBLE-CLICK
 * (codecraft-computer-helper.cmd): it finds Node.js (installs it with winget
 * when Windows has winget, otherwise opens the download page), unpacks the
 * helper to %LOCALAPPDATA%\Codecraft and starts it. No terminal typing.
 */
function buildWindowsLauncher(opts) {
  const js = asciiOnly(buildHelper(opts).replace(/^#!.*\n/, ''));
  const bat = [
    '@echo off',
    'setlocal',
    'title Codecraft Computer Helper',
    'set "CC_SELF=%~f0"',
    'set "CC_DIR=%LOCALAPPDATA%\\Codecraft"',
    'if not exist "%CC_DIR%" mkdir "%CC_DIR%"',
    'set "CC_JS=%CC_DIR%\\codecraft-computer-helper.js"',
    // Unpack everything after the marker line into CC_JS (UTF-8, no BOM).
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$l=Get-Content -LiteralPath $env:CC_SELF; $i=[array]::IndexOf($l, ':__CODECRAFT_'+'JS__'); if($i -lt 0){exit 1}; [IO.File]::WriteAllLines($env:CC_JS, [string[]]$l[($i+1)..($l.Length-1)])\"",
    'if errorlevel 1 (',
    '  echo Could not unpack the helper. Please download it again from the My computer page.',
    '  pause',
    '  exit /b 1',
    ')',
    'set "NODE="',
    'for /f "delims=" %%i in (\'where node 2^>nul\') do if not defined NODE set "NODE=%%i"',
    'if not defined NODE if exist "%ProgramFiles%\\nodejs\\node.exe" set "NODE=%ProgramFiles%\\nodejs\\node.exe"',
    'if not defined NODE (',
    '  echo This helper needs a free program called Node.js.',
    '  where winget >nul 2>nul && (',
    '    echo Installing it now. If Windows asks for permission, click Yes.',
    '    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements',
    '  )',
    '  if exist "%ProgramFiles%\\nodejs\\node.exe" set "NODE=%ProgramFiles%\\nodejs\\node.exe"',
    ')',
    'if not defined NODE (',
    '  echo.',
    '  echo A web page will open. Download the LTS version, open it and click Next until it is done.',
    '  echo Then double-click this file again.',
    '  start "" "https://nodejs.org/en/download"',
    '  pause',
    '  exit /b 1',
    ')',
    '"%NODE%" "%CC_JS%" %*',
    'if errorlevel 1 pause',
    'exit /b',
    ':__CODECRAFT_JS__',
  ].join('\r\n');
  return `${bat}\r\n${js.replace(/\r?\n/g, '\r\n')}`;
}

module.exports = { buildHelper, buildWindowsLauncher, MODULES };
