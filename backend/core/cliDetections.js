const detections = new Map(); // url -> { url, found, matches, checking, checkedAt }

function has(url) {
  return detections.has(url);
}

function markChecking(url) {
  detections.set(url, { url, checking: true, found: false, matches: [], checkedAt: null });
}

function record(url, result) {
  detections.set(url, { ...result, url, checking: false, checkedAt: new Date().toISOString() });
}

function get(url) {
  return detections.get(url) || null;
}

function list() {
  return [...detections.values()];
}

function _reset() {
  detections.clear();
}

module.exports = { has, markChecking, record, get, list, _reset };
