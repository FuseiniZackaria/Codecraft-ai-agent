/* Codecraft Computer Helper - main loop. Bundled by helperBundle.js together
 * with the safety modules in core/computerOperator; `__req`, `__config`,
 * `__SERVER_URL` and `__PAIR_CODE` are provided by the bundle.
 *
 * What it does: asks the Codecraft backend for work, and does ONLY the
 * computer actions in ops.js, ONLY inside the folders chosen here, on THIS PC.
 * The list of folders and apps lives in a file on this PC - the website can
 * show it but can never change it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const CONFIG_FILE = path.join(os.homedir(), '.codecraft-computer-helper.json');
const VERSION = 1;

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function saveSettings(s) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (a) => resolve(String(a || '').trim())));
}

function suggestedFolders() {
  const home = os.homedir();
  const names = ['Desktop', 'Documents', 'Downloads', 'Pictures'];
  const out = [];
  for (const base of [path.join(home, 'OneDrive'), home]) {
    for (const n of names) {
      const p = path.join(base, n);
      try {
        if (fs.statSync(p).isDirectory() && !out.some((x) => path.basename(x) === n)) out.push(p);
      } catch { /* not there */ }
    }
  }
  return out;
}

function isDriveRoot(p) {
  const r = path.resolve(p);
  return r === path.parse(r).root;
}

/** Yes/no question; Enter = the default. */
async function yesNo(rl, q, def) {
  for (;;) {
    const a = (await ask(rl, `${q} ${def ? '[Y/n]' : '[y/N]'} `)).toLowerCase();
    if (!a) return def;
    if (['y', 'yes'].includes(a)) return true;
    if (['n', 'no'].includes(a)) return false;
    console.log('  Please type Y for yes or N for no.');
  }
}

/** The normal Windows "choose a folder" window. Returns '' if closed or not on Windows. */
function folderWindow() {
  if (process.platform !== 'win32') return '';
  try {
    const ps =
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; " +
      "$f=New-Object System.Windows.Forms.Form; $f.TopMost=$true; " +
      "$d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose a folder the Codecraft AI may look at'; " +
      "if($d.ShowDialog($f) -eq 'OK'){ [Console]::Out.Write($d.SelectedPath) }";
    return require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return '';
  }
}

function checkFolder(p) {
  try {
    if (!fs.statSync(p).isDirectory()) return `${p} is not a folder`;
  } catch {
    return `${p} does not exist`;
  }
  if (isDriveRoot(p)) return `${p} is a whole drive - please choose a specific folder instead`;
  return null;
}

async function chooseOtherFolder(rl) {
  let p = folderWindow();
  if (!p) {
    if (process.platform === 'win32') console.log('  (No folder chosen in the window.)');
    p = (await ask(rl, '  Or type (or paste) the folder\'s full path, or press Enter to skip: ')).replace(/^"|"$/g, '');
  }
  return p;
}

async function pickFolders(rl) {
  console.log('\nWhich folders may the AI look at? It can never see anything outside them.\n');
  const picked = [];
  for (const p of suggestedFolders()) {
    if (await yesNo(rl, `Share your ${path.basename(p)} folder?`, true)) picked.push(path.resolve(p));
  }
  for (;;) {
    const more = await yesNo(rl, picked.length ? 'Add another folder?' : 'Choose a folder to share?', !picked.length);
    if (!more) {
      if (picked.length) break;
      console.log('  The AI needs at least one folder to work with.');
      continue;
    }
    const p = await chooseOtherFolder(rl);
    if (!p) continue;
    const bad = checkFolder(p);
    if (bad) { console.log(`  ${bad}.`); continue; }
    picked.push(path.resolve(p));
    console.log(`  Added ${path.resolve(p)}`);
  }
  return [...new Set(picked)];
}

// ---- Start automatically when the PC starts (Windows) ----
function startupFile() {
  if (process.platform !== 'win32' || !process.env.APPDATA) return null;
  return path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Codecraft Computer Helper.cmd');
}
function setAutoStart(on) {
  const f = startupFile();
  if (!f) return false;
  try {
    if (on) fs.writeFileSync(f, `@echo off\r\nstart "Codecraft Computer Helper" /min "${process.execPath}" "${__filename}"\r\n`);
    else fs.rmSync(f, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function pickApps(rl) {
  console.log('\nOptional: apps the AI may START for you (e.g. Notepad). Press Enter to skip.');
  console.log('Format: Name|full path to the .exe, separated by commas. Example: Notepad|C:\\Windows\\notepad.exe');
  const raw = await ask(rl, '> ');
  const apps = {};
  for (const entry of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [name, exe] = entry.split('|').map((x) => (x || '').trim().replace(/^"|"$/g, ''));
    if (!name || !exe) { console.log(`  Skipped "${entry}" (needs Name|path).`); continue; }
    apps[name] = exe;
  }
  return apps;
}

async function postJson(server, url, body, token, timeoutMs = 40_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${server}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

function applyToSafetyConfig(s) {
  __config.computerOperator.allowedRoots = s.roots || [];
  __config.computerOperator.allowedApps = s.apps || {};
}

function sharedLine(s) {
  return { name: s.name || os.hostname(), roots: s.roots || [], apps: Object.keys(s.apps || {}) };
}

async function setup(existing, { advanced = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\n=== Codecraft Computer Helper ===');
    console.log('This lets the Codecraft AI find and open your files, and - only after you approve');
    console.log('it on the Tasks page - move files to the Recycle Bin. ONLY in the folders you pick,');
    console.log('ONLY on this computer, and ONLY for your own requests.');
    console.log('Just answer the questions below: press Enter for the suggested answer.');
    const s = { ...(existing || {}), version: VERSION, server: (existing && existing.server) || __SERVER_URL };
    s.roots = await pickFolders(rl);
    // Apps the AI may start: only for people who ask for it (--advanced).
    if (advanced) s.apps = await pickApps(rl);
    else s.apps = s.apps || {};
    s.name = os.hostname();
    if (startupFile()) {
      const on = await yesNo(rl, '\nStart this helper automatically when you turn on this computer?', true);
      s.autoStart = setAutoStart(on) ? on : false;
    }
    if (!s.token) {
      let code = __PAIR_CODE;
      for (;;) {
        if (!code) code = await ask(rl, '\nConnect code from the "My computer" page (e.g. ABCD-2345): ');
        let status;
        let data;
        try {
          ({ status, data } = await postJson(s.server, '/api/computer-helper/pair', { code, ...sharedLine(s) }));
        } catch (err) {
          console.log(`  Can't reach Codecraft at ${s.server} (${err.name === 'AbortError' ? 'timed out' : err.message}). Check your internet, then press Enter to try again.`);
          await ask(rl, '');
          continue;
        }
        if (status === 200 && data && data.token) {
          s.token = data.token;
          break;
        }
        console.log(`  ${(data && data.error) || `Could not connect (HTTP ${status}).`}`);
        code = '';
      }
    }
    saveSettings(s);
    console.log('\nAll set! Your computer is connected.');
    console.log('Go back to the app and ask Ian, for example: "find my biggest files".');
    return s;
  } finally {
    rl.close();
  }
}

function stamp() {
  return new Date().toLocaleTimeString();
}

async function loop(s) {
  applyToSafetyConfig(s);
  const { runOp } = __req('./ops');
  console.log(`\nSharing: ${s.roots.join(', ')}`);
  if (Object.keys(s.apps || {}).length) console.log(`Apps: ${Object.keys(s.apps).join(', ')}`);
  console.log('Ready. Keep this window open (you can minimize it). Close it to stop the AI reaching this computer.\n');
  const waits = [5, 15, 30, 60];
  let fails = 0;
  let wasPaused = false;
  for (;;) {
    let r;
    try {
      r = await postJson(s.server, '/api/computer-helper/next', sharedLine(s), s.token);
    } catch (err) {
      const w = waits[Math.min(fails, waits.length - 1)];
      fails++;
      console.log(`[${stamp()}] Can't reach Codecraft (${err.name === 'AbortError' ? 'timed out' : err.message}) - retrying in ${w}s`);
      await new Promise((res) => setTimeout(res, w * 1000));
      continue;
    }
    if (r.status === 401) {
      console.log('\nThis computer was disconnected on the "My computer" page.');
      try { fs.unlinkSync(CONFIG_FILE); } catch { /* gone */ }
      setAutoStart(false);
      console.log('To connect again, get a new code on the page and run this helper again.');
      process.exit(0);
    }
    if (r.status !== 200) {
      const w = waits[Math.min(fails, waits.length - 1)];
      fails++;
      console.log(`[${stamp()}] Codecraft answered HTTP ${r.status}${r.data && r.data.error ? `: ${r.data.error}` : ''} - retrying in ${w}s`);
      await new Promise((res) => setTimeout(res, w * 1000));
      continue;
    }
    fails = 0;
    if (r.data && r.data.paused !== wasPaused) {
      wasPaused = !!r.data.paused;
      console.log(`[${stamp()}] ${wasPaused ? 'Paused on the page - doing nothing until you resume.' : 'Resumed.'}`);
    }
    const job = r.data && r.data.job;
    if (!job) continue;
    console.log(`[${stamp()}] ${job.summary || job.op}`);
    let out;
    try {
      out = { ok: true, result: await runOp(job.op, job.args || {}) };
    } catch (err) {
      out = { ok: false, error: err.message };
      console.log(`    -> refused/failed: ${err.message}`);
    }
    try {
      await postJson(s.server, `/api/computer-helper/jobs/${encodeURIComponent(job.id)}/result`, out, s.token);
    } catch (err) {
      console.log(`    -> could not send the answer back: ${err.message}`);
    }
  }
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.log(`This helper needs Node.js 18 or newer (you have ${process.versions.node}). Get it from https://nodejs.org`);
    process.exit(1);
  }
  const args = process.argv.slice(2);
  if (args.includes('--forget')) {
    try { fs.unlinkSync(CONFIG_FILE); } catch { /* none */ }
    setAutoStart(false);
    console.log('Forgot this computer\'s settings. Also click Disconnect on the "My computer" page.');
    return;
  }
  let s = loadSettings();
  const advanced = args.includes('--advanced');
  if (!s || !s.token || advanced || args.includes('--change-folders')) s = await setup(s, { advanced });
  await loop(s);
}
