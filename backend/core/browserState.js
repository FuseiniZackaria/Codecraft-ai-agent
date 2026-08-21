const MAX_HISTORY = 20;

let current = null; // { url, title, visitedAt }
const history = []; // most recent first, capped at MAX_HISTORY

function recordVisit({ url, title }) {
  const entry = { url, title: title || '', visitedAt: new Date().toISOString() };
  current = entry;
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  return entry;
}

function getCurrent() {
  return current;
}

function getRecent(limit = MAX_HISTORY) {
  return history.slice(0, limit);
}

function _reset() {
  // test-only helper
  current = null;
  history.length = 0;
}

module.exports = { recordVisit, getCurrent, getRecent, _reset };
