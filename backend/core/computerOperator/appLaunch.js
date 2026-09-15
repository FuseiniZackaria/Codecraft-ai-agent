const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('../../config');
const { launchWithDefaultApp } = require('./openFile');

/**
 * appLaunch.js - Stage 10: launch a specific, explicitly pre-approved
 * application by name (e.g. "Telegram Desktop", "CapCut", "WhatsApp Desktop").
 *
 * This is DELIBERATELY NOT the same allowlist as pathSafety.js's
 * COMPUTER_ALLOWED_ROOTS (which governs which FOLDERS this agent can
 * read/search/open files inside). Executables are hard-blocked from
 * openFile.js's file-opening path on purpose - launching an app needs its
 * own, separate, narrower allowlist: a fixed, explicit map of
 * app name -> launch target, configured once by the user via
 * COMPUTER_ALLOWED_APPS in .env. Nothing outside that named list can ever
 * be launched, no matter what folder it lives in or whether that folder
 * happens to be inside COMPUTER_ALLOWED_ROOTS - being readable and being
 * launchable are deliberately two separate permissions, and being inside
 * an allowed root never implies launch permission.
 *
 * TWO DIFFERENT LAUNCH TARGET TYPES are supported, because Windows itself
 * has two fundamentally different app installation models:
 *
 * 1. TRADITIONAL DESKTOP APPS (Telegram, CapCut) - installed as a real
 *    .exe file at a normal filesystem path. Launched the same way as
 *    opening a file - reuses launchWithDefaultApp from openFile.js.
 *
 * 2. MICROSOFT STORE / UWP APPS (e.g. the Store build of WhatsApp Desktop)
 *    - these do NOT live at a stable, directly-executable file path at
 *    all; Windows identifies them by an "AppUserModelID" instead (e.g.
 *    "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App", obtainable via
 *    `Get-StartApps` in PowerShell) and launches them via the
 *    shell:AppsFolder mechanism, not Start-Process on a file. Detected by
 *    the presence of "!" in the configured value, since a real Windows
 *    file path can never contain that character but every
 *    AppUserModelID does.
 */

function isAppUserModelId(value) {
  return typeof value === 'string' && value.includes('!');
}

function getAllowedApps() {
  // config.computerOperator.allowedApps is an object like:
  // { "telegram desktop": "C:\\...\\Telegram.exe",
  //   "whatsapp desktop": "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App" }
  // parsed once at startup from the COMPUTER_ALLOWED_APPS env var. Values
  // are either real file paths or AppUserModelIDs - distinguished at
  // launch time by isAppUserModelId(), not by anything in this map itself.
  return config.computerOperator?.allowedApps || {};
}

/**
 * Case-insensitive substring match against the configured app names -
 * mirrors the same zero/one/many resolution pattern used everywhere else
 * in the computer-operator system (findDirectoriesByName, searchFiles),
 * so the agent never guesses which app was meant.
 */
function findAppsByName(query) {
  const apps = getAllowedApps();
  const lowerQuery = String(query).toLowerCase().trim();
  return Object.entries(apps)
    .filter(([name]) => name.toLowerCase().includes(lowerQuery))
    .map(([name, target]) => ({ name, path: target }));
}

/**
 * Launches a Microsoft Store / UWP app via its AppUserModelID, using
 * explorer.exe's shell:AppsFolder virtual folder - the standard,
 * documented way to activate a packaged app from outside Windows' own
 * Start Menu, since these apps have no directly-executable file path to
 * Start-Process against.
 */
function launchStoreApp(appUserModelId) {
  return new Promise((resolve) => {
    // No quoting concerns here the way launchWithDefaultApp has for file
    // paths - an AppUserModelID never contains spaces or quote characters
    // by Windows' own packaging rules, so straightforward interpolation
    // is safe.
    const command = `explorer.exe shell:AppsFolder\\${appUserModelId}`;
    exec(command, (err) => {
      // GENUINELY FIRE-AND-FORGET, not just in intent but in implementation:
      // explorer.exe is a single, always-running Windows process - a new
      // "explorer.exe shell:AppsFolder\..." invocation hands the request
      // off to that existing instance rather than starting a second one,
      // and the invoking command frequently exits with a non-zero code as
      // an artifact of that hand-off even when the app opens successfully
      // seconds later. A non-zero exit here is NOT a reliable failure
      // signal the way it is for a normal process launch (contrast
      // launchWithDefaultApp, which DOES reject on error) - so this always
      // resolves. A real, permanent failure (e.g. an invalid/uninstalled
      // AppUserModelID) simply won't open anything, which the user will
      // notice directly rather than through an error message here.
      if (err) {
        console.warn(`[appLaunch] explorer.exe shell:AppsFolder exited non-zero (expected/benign for Store apps): ${err.message}`);
      }
      resolve();
    });
  });
}

/**
 * @param {string} target - must be an exact value already present in the
 *   configured allowlist (resolved via findAppsByName first) - never a
 *   raw, unchecked user-supplied value. Either a real file path or an
 *   AppUserModelID, per isAppUserModelId() above.
 */
async function launchApp(target) {
  if (!target || typeof target !== 'string') {
    throw new Error('launchApp requires a "target"');
  }

  const apps = getAllowedApps();
  const isAllowlisted = Object.values(apps).some((configured) => {
    if (isAppUserModelId(configured) || isAppUserModelId(target)) {
      return configured === target;
    }
    return path.resolve(configured) === path.resolve(target);
  });
  if (!isAllowlisted) {
    throw new Error(
      `"${target}" is not in the configured app allowlist - refusing to launch it. Add it to ` +
      `COMPUTER_ALLOWED_APPS in .env if this is an app you want the agent able to open.`
    );
  }

  if (isAppUserModelId(target)) {
    await launchStoreApp(target);
    return { status: 'launched', type: 'store_app', target };
  }

  let stat;
  try {
    stat = fs.statSync(target);
  } catch (err) {
    throw new Error(`"${target}" does not exist or could not be read: ${err.code || err.message}`);
  }
  if (!stat.isFile()) {
    throw new Error(`"${target}" is not a file.`);
  }

  await launchWithDefaultApp(target);
  return { status: 'launched', type: 'desktop_app', target };
}

module.exports = { getAllowedApps, findAppsByName, launchApp, isAppUserModelId };