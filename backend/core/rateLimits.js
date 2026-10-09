const rateLimit = require('express-rate-limit');

/**
 * General limiter for all authenticated /api routes - defense-in-depth
 * against a leaked session token or a runaway client bug, not the primary
 * access control (that's requireAuth/requireRole in server.js).
 */
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests - please slow down and try again shortly.' },
});

/**
 * Much stricter limit specifically on submitting a new goal - this is the
 * single most expensive/consequential action in the whole system (real AI
 * calls, potentially real WhatsApp sends, potentially irreversible actions
 * once approved), so it gets its own tighter budget independent of the
 * general limiter above.
 */
const goalSubmissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many goals submitted this hour - please wait before submitting more.' },
});

/**
 * /webhooks has no login (WhatsApp/Telegram can't authenticate as a user),
 * so this is its ONLY layer of abuse protection. Deliberately more generous
 * than the API limiters since real webhook traffic can legitimately burst.
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many webhook calls - rate limited.' },
});

/**
 * Admin-management mutations (grant/revoke admin role). Low cap because
 * these are rare, consequential actions - no legitimate workflow needs
 * dozens per hour, and a tight ceiling limits damage if an admin session
 * is compromised.
 */
const teamMutationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin changes this hour - please wait before trying again.' },
});

module.exports = { generalApiLimiter, goalSubmissionLimiter, webhookLimiter, teamMutationLimiter };