const KNOWN_PERMISSIONS = [
  'internet',
  'filesystem',
  'memory',
  'database',
  'crm',
  'whatsapp',
  'email',
  'browser_automation',
  'calendar',
  'github',
];

class PermissionDeniedError extends Error {}

/**
 * PermissionManager - single responsibility: enforce that a skill only
 * gets the permissions the user explicitly approved. Never auto-approves
 * anything - the caller (API route / CLI) asks the user and passes back
 * what they said yes to.
 */
class PermissionManager {
  validate(requested, approved) {
    const unapproved = requested.filter((p) => !approved.includes(p));
    if (unapproved.length) {
      throw new PermissionDeniedError(
        `Installation requires permissions that were not approved: ${unapproved.join(', ')}`
      );
    }
    const unknown = requested.filter((p) => !KNOWN_PERMISSIONS.includes(p));
    return { granted: requested, unknownPermissions: unknown };
  }

  /** On update, newly-requested permissions need fresh explicit re-approval. */
  diffForUpdate(previouslyApproved, newlyRequested) {
    return newlyRequested.filter((p) => !previouslyApproved.includes(p));
  }
}

module.exports = { PermissionManager, PermissionDeniedError, KNOWN_PERMISSIONS };
