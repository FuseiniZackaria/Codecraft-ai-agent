/**
 * scoreOpportunity.js - deterministic weighted scoring for a verified job
 * opportunity. Pure function: given points already earned per category, it
 * sums them and classifies the result. All the actual judgment (was the
 * company real, was the contact valid) happens upstream in
 * JobVerificationAgent - this module just applies the rubric consistently.
 *
 * Point weights match the spec exactly (sums to 100):
 *   freshness: 20, company: 20, jobListing: 25, contact: 15,
 *   relevance: 15, sourceReliability: 5
 */

const MAX_POINTS = {
  freshness: 20,
  company: 20,
  jobListing: 25,
  contact: 15,
  relevance: 15,
  sourceReliability: 5,
};

const DEFAULT_THRESHOLDS = {
  highlyVerified: 90, // 90-100
  verified: 75, // 75-89
  needsReview: 60, // 60-74, below 60 = do not contact
};

function clamp(value, max) {
  const n = Number(value);
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

/**
 * @param {object} points - earned points per category, each 0..MAX_POINTS[key]
 * @param {object} [overrides] - hard status overrides that bypass scoring entirely.
 *   An opportunity that is expired, a duplicate, or flagged suspicious must
 *   never be "upgraded" to VERIFIED by high scores elsewhere.
 * @param {object} [thresholds] - override default score bands
 */
function scoreOpportunity(points = {}, overrides = {}, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (overrides.expired) return { score: 0, status: 'EXPIRED', tier: 'Do not contact', breakdown: {} };
  if (overrides.duplicate) return { score: 0, status: 'DUPLICATE', tier: 'Do not contact', breakdown: {} };
  if (overrides.suspicious) return { score: 0, status: 'SUSPICIOUS', tier: 'Do not contact', breakdown: {} };

  const breakdown = {};
  let total = 0;
  for (const key of Object.keys(MAX_POINTS)) {
    const earned = clamp(points[key], MAX_POINTS[key]);
    breakdown[key] = earned;
    total += earned;
  }

  let status;
  let tier;
  if (total >= t.highlyVerified) {
    status = 'VERIFIED';
    tier = 'Highly verified';
  } else if (total >= t.verified) {
    status = 'VERIFIED';
    tier = 'Verified';
  } else if (total >= t.needsReview) {
    status = 'NEEDS_REVIEW';
    tier = 'Needs review';
  } else {
    status = 'NEEDS_REVIEW';
    tier = 'Do not contact';
  }

  return { score: total, status, tier, breakdown };
}

module.exports = { scoreOpportunity, MAX_POINTS, DEFAULT_THRESHOLDS };