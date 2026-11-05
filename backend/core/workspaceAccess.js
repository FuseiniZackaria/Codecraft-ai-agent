/**
 * Who may edit a workspace's knowledge base and agent settings.
 *
 * Today: the knowledge routes are mounted behind requireRole('admin') (see
 * server.js), and this check adds "you must belong to a workspace, as its owner
 * or an editor". Everything is read and written for req.user.workspaceId only,
 * so one business can never see another's.
 *
 * Later, to let clients edit their own knowledge base:
 *   1. give them a workspace_members row with role 'editor' (Team page),
 *   2. mount the knowledge routes with requireRole('admin', 'client') instead.
 * No other change is needed - this check already allows 'editor'.
 */

const EDIT_ROLES = new Set(['owner', 'editor']);

function canEditKnowledge(user) {
  if (!user?.workspaceId) return false;
  // Workspace role unknown (older login path) but a global admin: allow, as before.
  if (!user.workspaceRole) return user.role === 'admin';
  return EDIT_ROLES.has(user.workspaceRole);
}

function requireKnowledgeEditor(req, res, next) {
  if (!req.user?.workspaceId) {
    return res.status(400).json({ error: 'Your account isn\'t linked to a workspace yet - run migration 0001 so your admin owns a workspace.' });
  }
  if (!canEditKnowledge(req.user)) {
    return res.status(403).json({ error: 'You don\'t have permission to edit this workspace\'s knowledge base.' });
  }
  return next();
}

module.exports = { canEditKnowledge, requireKnowledgeEditor, EDIT_ROLES };
