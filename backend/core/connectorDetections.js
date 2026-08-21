const detections = new Map(); // origin -> { origin, found, matchedPath, manifest, checking, checkedAt }

function has(origin) {
  return detections.has(origin);
}

function markChecking(origin) {
  detections.set(origin, { origin, checking: true, found: false, matchedPath: null, manifest: null, checkedAt: null });
}

function record(origin, result) {
  detections.set(origin, { ...result, origin, checking: false, checkedAt: new Date().toISOString() });
}

function get(origin) {
  return detections.get(origin) || null;
}

function list() {
  return [...detections.values()];
}

function _reset() {
  detections.clear();
}

module.exports = { has, markChecking, record, get, list, _reset };
