const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const memory = require('../memory');
const { teamMutationLimiter } = require('../core/rateLimits');
const { invalidateUser, invalidateSoleWorkspace } = require('../core/workspaceContext');

const router = express.Router();

const supabase = config.supabase.url && config.supabase.serviceKey
  ? createClient(config.supabase.url, config.supabase.serviceKey)
  : null;

function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({ error: 'Auth is not configured on this server (missing SUPABASE_URL/SUPABASE_SERVICE_KEY)' });
    return false;
  }
  return true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getAdminRoleId() {
  const { data, error } = await supabase.from('roles').select('id').eq('name', 'admin').maybeSingle();
  if (error) throw new Error(`Failed to look up admin role: ${error.message}`);
  if (!data) throw new Error('Admin role is not configured in the roles table');
  return data.id;
}

async function findUserByEmail(email) {
  const target = email.trim().toLowerCase();
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    const users = data?.users || [];
    const match = users.find((u) => (u.email || '').toLowerCase() === target);
    if (match) return match;
    if (users.length < perPage) return null;
    page += 1;
    if (page > 50) return null;
  }
}

// ---------- GET /team ----------
router.get('/', async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const adminRoleId = await getAdminRoleId();
    const callerWorkspaceId = req.user?.workspaceId || null;

    const { data: adminRows, error: rolesError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role_id', adminRoleId);
    if (rolesError) throw new Error(`Failed to list admins: ${rolesError.message}`);

    const adminIds = new Set((adminRows || []).map((r) => r.user_id));
    if (adminIds.size === 0) return res.json([]);

    // Fetch workspace membership for context
    let memberRows = [];
    if (callerWorkspaceId) {
      const { data: mRows } = await supabase
        .from('workspace_members')
        .select('user_id, role, workspace_id')
        .eq('workspace_id', callerWorkspaceId);
      memberRows = mRows || [];
    }
    const memberMap = new Map(memberRows.map((m) => [m.user_id, m]));

    const found = [];
    let page = 1;
    const perPage = 1000;
    const remaining = new Set(adminIds);
    while (remaining.size > 0) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(`Failed to look up admin emails: ${error.message}`);
      const users = data?.users || [];
      for (const u of users) {
        if (remaining.has(u.id)) {
          const membership = memberMap.get(u.id);
          found.push({
            id: u.id,
            email: u.email || null,
            createdAt: u.created_at || null,
            lastSignInAt: u.last_sign_in_at || null,
            isYou: u.id === req.user.id,
            workspaceRole: membership?.role || null,
            inMyWorkspace: !!membership,
          });
          remaining.delete(u.id);
        }
      }
      if (users.length < perPage) break;
      page += 1;
      if (page > 50) break;
    }

    found.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
    res.json(found);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST /team ----------
router.post('/', teamMutationLimiter, async (req, res) => {
  if (!requireSupabase(res)) return;

  const { email, mode } = req.body || {};
  const trimmedEmail = (email || '').trim();
  const addMode = mode === 'team_member' ? 'team_member' : 'new_workspace';

  if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  if (req.user.workspaceRole !== 'owner') {
    return res.status(403).json({ error: 'Only the workspace owner can add team members.' });
  }

  const callerWorkspaceId = req.user?.workspaceId;
  if (addMode === 'team_member' && !callerWorkspaceId) {
    return res.status(400).json({ error: 'You must have a workspace before adding team members.' });
  }

  try {
    const adminRoleId = await getAdminRoleId();

    // --- Create or find the user ---
    let userId;
    let userEmail;
    let existingAccount = false;
    let inviteSent = false;

    const existing = await findUserByEmail(trimmedEmail);
    if (existing) {
      userId = existing.id;
      userEmail = existing.email;
      existingAccount = true;
    } else {
      const redirectUrl = `${req.headers.origin || ''}/`;
      const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
        trimmedEmail,
        { redirectTo: redirectUrl },
      );
      if (inviteError) {
        return res.status(400).json({ error: inviteError.message });
      }
      userId = invited.user.id;
      userEmail = invited.user.email;
      inviteSent = true;
    }

    // --- Check they're not already an admin ---
    const { data: existingRoleRow, error: existingRoleError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('user_id', userId)
      .eq('role_id', adminRoleId)
      .maybeSingle();
    if (existingRoleError) {
      return res.status(500).json({ error: `Failed to check role: ${existingRoleError.message}` });
    }

    // If already admin, check workspace membership
    if (existingRoleRow) {
      const { data: memberRow } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (addMode === 'team_member' && memberRow && memberRow.workspace_id !== callerWorkspaceId) {
        return res.status(409).json({ error: 'This admin already belongs to a different workspace.' });
      }
      if (addMode === 'team_member' && memberRow && memberRow.workspace_id === callerWorkspaceId) {
        return res.json({ id: userId, email: userEmail, existingAccount: true, alreadyMember: true });
      }
      if (addMode === 'new_workspace' && memberRow) {
        return res.status(409).json({ error: 'This admin already has a workspace.' });
      }
    }

    // --- Grant admin role ---
    if (!existingRoleRow) {
      const { error: insertError } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role_id: adminRoleId });
      if (insertError) {
        return res.status(500).json({ error: `Failed to grant admin role: ${insertError.message}` });
      }
    }

    // --- Workspace setup ---
    if (addMode === 'new_workspace') {
      const workspaceName = `${trimmedEmail.split('@')[0]}'s workspace`;

      const { data: wsData, error: wsError } = await supabase
        .from('workspaces')
        .insert({ name: workspaceName, owner_user_id: userId })
        .select('id')
        .single();
      if (wsError) {
        return res.status(500).json({ error: `Failed to create workspace: ${wsError.message}` });
      }

      await supabase
        .from('workspace_members')
        .insert({ workspace_id: wsData.id, user_id: userId, role: 'owner' });

      await supabase
        .from('business_profile')
        .insert({ workspace_id: wsData.id })
        .then(() => {});

      invalidateSoleWorkspace();
    } else {
      // team_member: check they're not already in another workspace
      const { data: existingMembership } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (existingMembership && existingMembership.workspace_id !== callerWorkspaceId) {
        return res.status(409).json({ error: 'This user already belongs to a different workspace.' });
      }

      if (!existingMembership) {
        const { error: memberError } = await supabase
          .from('workspace_members')
          .insert({ workspace_id: callerWorkspaceId, user_id: userId, role: 'member' });
        if (memberError) {
          return res.status(500).json({ error: `Failed to add to workspace: ${memberError.message}` });
        }
      }
    }

    invalidateUser(userId);

    try {
      await memory.audit(req.user.email || req.user.id, 'admin_added', userEmail || userId, {
        targetUserId: userId,
        mode: addMode,
        existingAccount,
        inviteSent,
        workspaceId: callerWorkspaceId,
      }, { workspaceId: callerWorkspaceId });
    } catch {
      // Non-fatal
    }

    res.status(201).json({
      id: userId,
      email: userEmail,
      existingAccount,
      inviteSent,
      mode: addMode,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- DELETE /team/:userId ----------
router.delete('/:userId', teamMutationLimiter, async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });
  if (userId === req.user.id) {
    return res.status(400).json({ error: "You can't remove yourself." });
  }

  if (req.user.workspaceRole !== 'owner') {
    return res.status(403).json({ error: 'Only the workspace owner can remove team members.' });
  }

  try {
    const adminRoleId = await getAdminRoleId();
    const callerWorkspaceId = req.user?.workspaceId;

    // Only allow removing members of the caller's own workspace
    if (callerWorkspaceId) {
      const { data: targetMember } = await supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', userId)
        .maybeSingle();

      if (targetMember && targetMember.workspace_id !== callerWorkspaceId) {
        return res.status(403).json({ error: 'You can only remove members of your own workspace.' });
      }

      if (targetMember && targetMember.role === 'owner') {
        return res.status(400).json({ error: "You can't remove a workspace owner. Transfer ownership first." });
      }

      // Remove from workspace_members
      if (targetMember) {
        await supabase
          .from('workspace_members')
          .delete()
          .eq('user_id', userId)
          .eq('workspace_id', callerWorkspaceId);
      }
    }

    // Check they are an admin
    const { data: existingRoleRow, error: existingRoleError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('user_id', userId)
      .eq('role_id', adminRoleId)
      .maybeSingle();
    if (existingRoleError) {
      return res.status(500).json({ error: `Failed to check role: ${existingRoleError.message}` });
    }
    if (!existingRoleRow) {
      return res.status(404).json({ error: 'That user is not an admin.' });
    }

    // Revoke admin role
    const { error: deleteError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', adminRoleId);
    if (deleteError) {
      return res.status(500).json({ error: `Failed to revoke admin role: ${deleteError.message}` });
    }

    let targetEmail = userId;
    try {
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      if (userData?.user?.email) targetEmail = userData.user.email;
    } catch {
      // Non-fatal
    }

    invalidateUser(userId);

    try {
      await memory.audit(req.user.email || req.user.id, 'admin_removed', targetEmail, {
        targetUserId: userId,
        workspaceId: callerWorkspaceId,
      }, { workspaceId: callerWorkspaceId });
    } catch {
      // Non-fatal
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
