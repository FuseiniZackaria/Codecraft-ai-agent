// Computer Helper: each person connects THEIR OWN computer, and computer
// actions reach only the computer of the person asking (owner's rule:
// own PC only). Covers connecting, routing, pause/offline, approved deletes
// pinned to one person's PC, task privacy, the helper routes, and the
// downloadable one-file helper (same safety rules as the server).

process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_TESTING = '1';
process.env.COMPUTER_HELPER_POLL_MS = '300';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const config = require('../config');
const ctx = require('../core/usage/context');
const devices = require('../core/computerOperator/devices');
const target = require('../core/computerOperator/target');
const { isOthersComputerTask, hideOthersComputerTasks } = require('../core/computerOperator/taskPrivacy');
const { buildHelper } = require('../core/computerOperator/helperBundle');

const A = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com', role: 'admin' };
const B = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com', role: 'admin' };
const OWNER = { id: '33333333-3333-4333-8333-333333333333', email: 'owner@example.com', role: 'owner' };
const as = (user, fn) => ctx.runForUser(user, fn);

// A fake helper: answers the next job for a device with `answer(job)`.
async function serveOnce(deviceId, answer) {
  for (let i = 0; i < 50; i++) {
    const job = await devices.claimNext(deviceId);
    if (job) {
      try {
        await devices.finishJob(deviceId, job.id, { ok: true, result: await answer(job) });
      } catch (err) {
        await devices.finishJob(deviceId, job.id, { ok: false, error: err.message });
      }
      return job;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no job arrived');
}

async function main() {
  const originalRoots = config.computerOperator.allowedRoots;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-helper-'));
  fs.writeFileSync(path.join(tmpRoot, 'invoice-2026.pdf'), 'pdf');
  fs.writeFileSync(path.join(tmpRoot, 'setup.exe'), 'exe');
  try {
    devices._test.reset();

    // --- Connecting: one-time code -> secret ---
    const p = await devices.createPairing({ userId: A.id });
    assert.match(p.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.strictEqual(await devices.redeemPairing({ code: 'WRON-GCOD' }), null, 'wrong code refused');
    const paired = await devices.redeemPairing({ code: p.code.toLowerCase().replace('-', ' '), name: 'A-PC', roots: ['C:\\A\\Docs'], apps: ['Notepad'] });
    assert.ok(paired && paired.token.length >= 64);
    assert.strictEqual(await devices.redeemPairing({ code: p.code }), null, 'a code works once');
    const devA = await devices.deviceByToken(paired.token);
    assert.strictEqual(devA.user_id, A.id);
    assert.ok(!JSON.stringify(devices.publicDevice(devA)).includes(paired.token), 'the page never sees the secret');
    assert.ok(!('token_hash' in devices.publicDevice(devA)));
    const expired = await devices.createPairing({ userId: B.id });
    devices._test.mem.devices.get(expired.deviceId).pair_expires_at = new Date(Date.now() - 1000).toISOString();
    assert.strictEqual(await devices.redeemPairing({ code: expired.code }), null, 'expired code refused');
    console.log('✓ connect codes: work once, expire, and the secret is never shown back');

    // --- Own PC only: A reaches A's computer; B (no computer) reaches nothing ---
    config.computerOperator.allowedRoots = [tmpRoot]; // server local mode is ON, to prove B still can't use it
    const served = serveOnce(devA.id, (job) => ({ results: [{ path: 'C:\\A\\Docs\\x.pdf' }], echo: job.args }));
    const res = await as(A, () => target.call('searchFiles', { query: 'x' }));
    const job = await served;
    assert.strictEqual(job.user_id, A.id);
    assert.strictEqual(res.results[0].path, 'C:\\A\\Docs\\x.pdf');
    assert.strictEqual(devices._test.mem.jobs.get(job.id).result, null, 'file list wiped once read');
    assert.strictEqual(devices._test.mem.jobs.get(job.id).summary, 'Searched for "x"');
    await assert.rejects(() => as(B, () => target.call('searchFiles', { query: 'invoice' })), /Connect your computer first/);
    console.log("✓ A's request runs on A's computer; B without a computer gets nothing (not the server's files)");

    // --- Owner local mode still works (backend on the owner's PC) ---
    const local = await as(OWNER, () => target.call('searchFiles', { query: 'invoice' }));
    assert.strictEqual(local.results.length, 1);
    const noPerson = await target.call('searchFiles', { query: 'invoice' });
    assert.strictEqual(noPerson.results.length, 1, 'no-person work (tests, local Telegram) keeps the old local mode');
    console.log('✓ the owner\'s local mode is unchanged');

    // --- Paused / offline ---
    await devices.setPaused(A.id, devA.id, true);
    await assert.rejects(() => as(A, () => target.call('searchFiles', { query: 'x' })), /paused/);
    assert.strictEqual(await devices.setPaused(B.id, devA.id, false), null, "B can't resume A's computer");
    await devices.setPaused(A.id, devA.id, false);
    devices._test.setLastSeen(devA.id, new Date(Date.now() - 10 * 60 * 1000).toISOString());
    await assert.rejects(() => as(A, () => target.call('searchFiles', { query: 'x' })), /not connected right now/);
    devices._test.setLastSeen(devA.id, new Date().toISOString());
    console.log('✓ paused or offline computers get a clear message; only the person can pause/resume');

    // --- An approved delete runs only on the computer it was planned on, approved by that person ---
    const pin = { deviceId: devA.id, forUserId: A.id };
    await assert.rejects(() => as(B, () => target.call('deleteToRecycleBin', { paths: ['C:\\A\\Docs\\x.pdf'] }, pin)), /Only the person/);
    await assert.rejects(() => as(OWNER, () => target.call('deleteToRecycleBin', { paths: ['C:\\A\\Docs\\x.pdf'] }, pin)), /Only the person/);
    const servedDel = serveOnce(devA.id, (j) => ({ results: j.args.paths.map((x) => ({ path: x, status: 'recycled' })), succeeded: 1, failed: 0 }));
    const delAction = require('../plugins/computer/actions/deleteToRecycleBin');
    const del = await as(A, () => delAction.run({ paths: ['C:\\A\\Docs\\x.pdf'], ...pin }));
    await servedDel;
    assert.strictEqual(del.succeeded, 1);
    console.log('✓ approved deletes: only the PC\'s person can approve, and it runs only on that PC');

    // --- Task privacy ---
    const t = { agent: 'computer-operator', toolCall: { tool: 'computer.deleteToRecycleBin' }, payload: { paths: ['x'], forUserId: A.id } };
    assert.strictEqual(isOthersComputerTask(t, A.id), false);
    assert.strictEqual(isOthersComputerTask(t, B.id), true);
    assert.strictEqual(isOthersComputerTask(t, OWNER.id), true, 'not even the owner');
    assert.strictEqual(isOthersComputerTask({ agent: 'computer-operator', computer_for_user: A.id }, B.id), true, 'lite rows too');
    assert.strictEqual(isOthersComputerTask({ toolCall: { tool: 'computer.deleteToRecycleBin' }, payload: { paths: ['x'] } }, B.id), false, 'local-mode tasks unchanged');
    assert.strictEqual(as(B, () => hideOthersComputerTasks([t, { agent: 'sales' }])).length, 1);
    assert.strictEqual(hideOthersComputerTasks([t]).length, 0, 'no-person channels see none');
    console.log("✓ someone's computer requests are hidden from everyone else");

    // --- Disconnect ---
    assert.strictEqual(await devices.revoke(B.id, devA.id), false, "B can't disconnect A's computer");
    assert.strictEqual(await devices.revoke(A.id, devA.id), true);
    assert.strictEqual(await devices.deviceByToken(paired.token), null, 'secret stops working');
    console.log('✓ disconnect: only the person, and the helper secret stops working');

    // --- Helper routes end to end (pair -> long poll -> result) ---
    const app = express();
    app.use(express.json());
    app.use('/api/computer-helper', require('../api/computerHelperRoutes'));
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/computer-helper`;
    const post = async (url, body, token) => {
      const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
      return { status: r.status, data: await r.json() };
    };
    try {
      const code = (await devices.createPairing({ userId: B.id })).code;
      assert.strictEqual((await post('/pair', { code: 'AAAA-BBBB' })).status, 400);
      const pr = await post('/pair', { code, name: 'B-PC', roots: ['D:\\B'], apps: [] });
      assert.strictEqual(pr.status, 200);
      assert.strictEqual((await post('/next', {}, 'f'.repeat(64))).status, 401, 'wrong secret refused');
      const empty = await post('/next', { roots: ['D:\\B'] }, pr.data.token);
      assert.deepStrictEqual(empty.data, { job: null, paused: false });
      const pending = as(B, () => target.call('findLargeFiles', { minSizeMB: 100 }));
      const got = await post('/next', {}, pr.data.token);
      assert.strictEqual(got.data.job.op, 'findLargeFiles');
      assert.deepStrictEqual(got.data.job.args, { minSizeMB: 100 });
      assert.strictEqual((await post(`/jobs/${got.data.job.id}/result`, { ok: true, result: { results: [] } }, 'e'.repeat(64))).status, 401);
      assert.strictEqual((await post(`/jobs/${got.data.job.id}/result`, { ok: true, result: { results: [], totalScanned: 3 } }, pr.data.token)).status, 200);
      assert.strictEqual((await pending).totalScanned, 3);
      console.log('✓ helper routes: connect, wait for work, send the answer back (secret required)');
    } finally {
      server.close();
    }

    // --- The downloadable helper: one file, same safety rules ---
    const src = buildHelper({ serverUrl: 'https://example.onrender.com', pairCode: 'ABCD-2345' });
    assert.ok(src.includes('"https://example.onrender.com"') && src.includes('"ABCD-2345"'));
    assert.throws(() => buildHelper({ serverUrl: 'javascript:alert(1)' }), /Bad server/);
    assert.throws(() => buildHelper({ serverUrl: 'https://x.com', pairCode: '"; evil()' }), /Bad connect code/);
    const file = path.join(os.tmpdir(), `cc-helper-bundle-${process.pid}.js`);
    fs.writeFileSync(file, src);
    process.env.CC_HELPER_NO_MAIN = '1';
    const helper = require(file);
    delete process.env.CC_HELPER_NO_MAIN;
    const { runOp } = helper.__req('./ops');
    await assert.rejects(() => runOp('searchFiles', { query: 'invoice' }), /No folders are shared/);
    helper.__config.computerOperator.allowedRoots = [tmpRoot];
    assert.strictEqual((await runOp('searchFiles', { query: 'invoice' })).results.length, 1);
    await assert.rejects(() => runOp('openFile', { filePath: path.join(tmpRoot, 'setup.exe') }), /executables\/scripts/);
    await assert.rejects(() => runOp('listDirectory', { dirPath: os.homedir() === tmpRoot ? '/' : os.homedir() }), /outside the allowed folders/);
    await assert.rejects(() => runOp('launchApp', { exePath: 'C:\\Windows\\System32\\cmd.exe' }), /not in the list/);
    await assert.rejects(() => runOp('formatDisk', {}), /Unknown computer action/);
    await assert.rejects(() => runOp('deleteToRecycleBin', { paths: Array.from({ length: 21 }, (_, i) => `${tmpRoot}/f${i}`) }), /safety cap/);
    assert.strictEqual(config.computerOperator.allowedRoots[0], tmpRoot, "the helper's settings are its own, separate from the server's");
    fs.rmSync(file, { force: true });
    console.log('✓ the downloadable helper keeps every safety rule (folders, blocked types, app list, delete cap)');

    // --- Windows double-click file: same helper, packed after a marker line ---
    const { buildWindowsLauncher } = require('../core/computerOperator/helperBundle');
    const cmd = buildWindowsLauncher({ serverUrl: 'https://example.onrender.com', pairCode: 'ABCD-2345' });
    assert.ok(cmd.startsWith('@echo off\r\n'), 'a Windows batch file');
    assert.ok(!/[^\r]\n/.test(cmd), 'Windows line endings throughout');
    assert.ok(!/[^\x00-\x7F]/.test(cmd), 'plain ASCII, so it unpacks unchanged');
    const lines = cmd.split('\r\n');
    const at = lines.indexOf(':__CODECRAFT_JS__');
    assert.ok(at > 0 && lines.indexOf(':__CODECRAFT_JS__', at + 1) === -1, 'exactly one marker line');
    assert.ok(lines.slice(0, at).includes('exit /b'), 'the batch part stops before the script');
    assert.ok(lines.slice(at + 1).join('\n').includes('"ABCD-2345"'), 'the helper (with its code) follows the marker');
    console.log('✓ the Windows double-click file carries the same helper');

    console.log('\ncomputer-helper: all checks passed');
  } finally {
    config.computerOperator.allowedRoots = originalRoots;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
