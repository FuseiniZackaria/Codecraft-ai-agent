const DEFAULT_BACKEND_URL = 'http://localhost:4000';

let lastReportedUrl = null;

async function getSettings() {
  const { ccBackendUrl, ccToken, ccEnabled } = await chrome.storage.local.get(['ccBackendUrl', 'ccToken', 'ccEnabled']);
  return {
    backendUrl: ccBackendUrl || DEFAULT_BACKEND_URL,
    token: ccToken || null,
    enabled: ccEnabled !== false, // default on
  };
}

function isReportable(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function reportVisit(tab) {
  if (!tab || !isReportable(tab.url)) return;
  if (tab.url === lastReportedUrl) return; // dedupe: same URL, don't spam

  const { backendUrl, token, enabled } = await getSettings();
  if (!enabled) return;
  if (!token) {
    await setBadge('!', '#d97706'); // amber: not paired yet
    return;
  }

  try {
    const res = await fetch(`${backendUrl}/api/browser/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CodeCraft-Token': token },
      body: JSON.stringify({ url: tab.url, title: tab.title || '' }),
    });
    if (res.ok) {
      lastReportedUrl = tab.url;
      await setBadge('', '#16a34a'); // clear badge, green icon state implied
      await chrome.storage.local.set({ ccLastReported: { url: tab.url, title: tab.title || '', at: new Date().toISOString() } });
    } else if (res.status === 401) {
      await setBadge('!', '#dc2626'); // red: bad token
    } else {
      await setBadge('?', '#dc2626');
    }
  } catch {
    // Backend not running/unreachable - fail quiet, just show status in the
    // badge rather than spamming the console on every navigation.
    await setBadge('x', '#6b7280');
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  reportVisit(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') reportVisit(tab);
});
