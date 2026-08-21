const $ = (id) => document.getElementById(id);

async function load() {
  const { ccBackendUrl, ccToken, ccEnabled, ccLastReported } = await chrome.storage.local.get([
    'ccBackendUrl', 'ccToken', 'ccEnabled', 'ccLastReported',
  ]);
  $('backendUrl').value = ccBackendUrl || 'http://localhost:4000';
  $('token').value = ccToken || '';
  $('enabled').checked = ccEnabled !== false;

  if (!ccToken) {
    setStatus('Paste your BROWSER_EXTENSION_TOKEN (from the backend .env) and save.', null);
  } else if (ccLastReported) {
    setStatus(`Last reported: ${ccLastReported.title || ccLastReported.url}\n(${new Date(ccLastReported.at).toLocaleTimeString()})`, 'ok');
  } else {
    setStatus('Paired. Switch tabs or reload a page to send the first report.', null);
  }
}

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = kind || '';
}

async function verifyPairing(backendUrl, token) {
  try {
    const res = await fetch(`${backendUrl}/api/browser/current`, {
      headers: { 'X-CodeCraft-Token': token },
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, message: 'Backend rejected that token - check it matches BROWSER_EXTENSION_TOKEN in .env.' };
    if (res.status === 503) return { ok: false, message: 'Backend has no BROWSER_EXTENSION_TOKEN set - set one in .env and restart it.' };
    return { ok: false, message: `Unexpected response (HTTP ${res.status}).` };
  } catch {
    return { ok: false, message: `Could not reach ${backendUrl} - is the CodeCraft backend running?` };
  }
}

$('save').addEventListener('click', async () => {
  const backendUrl = $('backendUrl').value.trim().replace(/\/$/, '') || 'http://localhost:4000';
  const token = $('token').value.trim();
  const enabled = $('enabled').checked;

  await chrome.storage.local.set({ ccBackendUrl: backendUrl, ccToken: token, ccEnabled: enabled });

  if (!token) {
    setStatus('Saved, but no token set yet - reporting will stay paused until you add one.', null);
    return;
  }

  setStatus('Checking connection...', null);
  const result = await verifyPairing(backendUrl, token);
  setStatus(result.ok ? 'Paired successfully. Reporting is now active.' : result.message, result.ok ? 'ok' : 'err');
});

load();
