-- 0013b - Make YOUR account the owner (run after 0013).
-- Replace you@example.com with the email you log in with, then run it.
-- Your account keeps its admin role too; nothing else changes.

insert into user_roles (user_id, role_id)
select u.id, r.id
from auth.users u
join roles r on r.name = 'owner'
where lower(u.email) = lower('you@example.com')
  and not exists (select 1 from user_roles ur where ur.user_id = u.id and ur.role_id = r.id);

-- Check: should show your email with the role "owner".
select u.email, r.name as role
from user_roles ur join auth.users u on u.id = ur.user_id join roles r on r.id = ur.role_id
where r.name = 'owner';
