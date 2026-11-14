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

async function pickFolders(rl) {
  const sugg = suggestedFolders();
  console.log('\nWhich folders may the AI look at? Nothing outside them is ever touched.');
  if (sugg.length) {
    console.log('Suggestions:');
    sugg.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log('Type numbers (e.g. 1,2), full folder paths, or both, separated by commas.');
  } else {
    console.log('Type full folder paths, separated by commas.');
  }
  for (;;) {
    const raw = await ask(rl, '> ');
    const picked = [];
    let bad = null;
    for (const part of raw.split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean)) {
      const p = /^\d+$/.test(part) ? sugg[Number(part) - 1] : part;
      if (!p) { bad = `"${part}" is not one of the numbers above`; break; }
      try {
        if (!fs.statSync(p).isDirectory()) { bad = `${p} is not a folder`; break; }
      } catch { bad = `${p} does not exist`; break; }
      if (isDriveRoot(p)) { bad = `${p} is a whole drive - please pick specific folders instead`; break; }
      picked.push(path.resolve(p));
    }
    if (bad) { console.log(`  ${bad}. Try again.`); continue; }
    if (!picked.length) { console.log('  Pick at least one folder.'); continue; }
    return [...new Set(picked)];
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

async function setup(existing) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\n=== Codecraft Computer Helper - setup ===');
    console.log('This lets the Codecraft AI search, open and (only with your approval on the Tasks page)');
    console.log('move files to the Recycle Bin - ONLY in the folders you pick, ONLY on this computer,');
    console.log('and ONLY for your own requests. Close this window any time to stop it.');
    const s = { ...(existing || {}), version: VERSION, server: (existing && existing.server) || __SERVER_URL };
    s.roots = await pickFolders(rl);
    s.apps = await pickApps(rl);
    s.name = os.hostname();
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
    console.log(`\nConnected. Settings saved in ${CONFIG_FILE}`);
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
  console.log('Waiting for your requests... (keep this window open; close it to stop)\n');
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
    console.log('Forgot this computer\'s settings. Also click Disconnect on the "My computer" page.');
    return;
  }
  let s = loadSettings();
  if (!s || !s.token || args.includes('--change-folders')) s = await setup(s);
  await loop(s);
}
