const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const memory = require('../memory');
const { teamMutationLimiter } = require('../core/rateLimits');

const router = express.Router();

// Service-key client stays on the server - it bypasses RLS, so it must
// never be exposed through a response, log line, or client-side bundle.
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
const MIN_PASSWORD_LENGTH = 8;

async function getAdminRoleId() {
  const { data, error } = await supabase.from('roles').select('id').eq('name', 'admin').maybeSingle();
  if (error) throw new Error(`Failed to look up admin role: ${error.message}`);
  if (!data) throw new Error('Admin role is not configured in the roles table');
  return data.id;
}

async function findUserByEmail(email) {
  // supabase.auth.admin.listUsers paginates - walk pages until we find them
  // or run out. 1000 users per page is the service limit.
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
    if (page > 50) return null; // hard cap - 50k users is well past any realistic team dashboard
  }
}

router.get('/', async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const adminRoleId = await getAdminRoleId();
    const { data: adminRows, error: rolesError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role_id', adminRoleId);
    if (rolesError) throw new Error(`Failed to list admins: ${rolesError.message}`);

    const adminIds = new Set((adminRows || []).map((r) => r.user_id));
    if (adminIds.size === 0) return res.json([]);

    // Walk auth.users pages, keeping only the admins we care about. Avoids
    // one getUser() round-trip per admin.
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
          found.push({
            id: u.id,
            email: u.email || null,
            createdAt: u.created_at || null,
            lastSignInAt: u.last_sign_in_at || null,
            isYou: u.id === req.user.id,
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

router.post('/', teamMutationLimiter, async (req, res) => {
  if (!requireSupabase(res)) return;
  const { email, password } = req.body || {};
  const trimmedEmail = (email || '').trim();
  if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  try {
    const adminRoleId = await getAdminRoleId();

    let userId;
    let userEmail;
    let existingAccount = false;
    let createdHere = false;

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
    });

    if (createError) {
      // Supabase returns a 422 / "User already registered" / "already been
      // registered" style message. Fall back to lookup rather than failing.
      const existing = await findUserByEmail(trimmedEmail);
      if (!existing) {
        return res.status(400).json({ error: createError.message });
      }
      userId = existing.id;
      userEmail = existing.email;
      existingAccount = true;
    } else {
      userId = created.user.id;
      userEmail = created.user.email;
      createdHere = true;
    }

    // Check if they're already an admin before inserting.
    const { data: existingRoleRow, error: existingRoleError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('user_id', userId)
      .eq('role_id', adminRoleId)
      .maybeSingle();
    if (existingRoleError) {
      if (createdHere) {
        await supabase.auth.admin.deleteUser(userId).catch(() => {});
      }
      return res.status(500).json({ error: `Failed to check role: ${existingRoleError.message}` });
    }
    if (existingRoleRow) {
      return res.json({
        id: userId,
        email: userEmail,
        existingAccount: true,
        alreadyAdmin: true,
      });
    }

    const { error: insertError } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, role_id: adminRoleId });
    if (insertError) {
      // Only clean up if we just created the account - never delete an
      // account that already belonged to someone.
      if (createdHere) {
        await supabase.auth.admin.deleteUser(userId).catch(() => {});
      }
      return res.status(500).json({ error: `Failed to grant admin role: ${insertError.message}` });
    }

    try {
      await memory.audit(req.user.email || req.user.id, 'admin_granted', userEmail || userId, {
        targetUserId: userId,
        existingAccount,
      });
    } catch {
      // Audit log failures must not leak the password or prevent success.
    }

    res.status(201).json({
      id: userId,
      email: userEmail,
      existingAccount,
      alreadyAdmin: false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:userId', teamMutationLimiter, async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });
  if (userId === req.user.id) {
    return res.status(400).json({ error: "You can't remove yourself." });
  }

  try {
    const adminRoleId = await getAdminRoleId();

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

    const { count, error: countError } = await supabase
      .from('user_roles')
      .select('*', { count: 'exact', head: true })
      .eq('role_id', adminRoleId);
    if (countError) {
      return res.status(500).json({ error: `Failed to count admins: ${countError.message}` });
    }
    if ((count || 0) <= 1) {
      return res.status(400).json({ error: "Can't remove the last admin." });
    }

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
      // Non-fatal - fall back to the id in the audit record.
    }

    try {
      await memory.audit(req.user.email || req.user.id, 'admin_revoked', targetEmail, {
        targetUserId: userId,
      });
    } catch {
      // Non-fatal.
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
