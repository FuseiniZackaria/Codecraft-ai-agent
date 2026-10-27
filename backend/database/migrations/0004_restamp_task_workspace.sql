-- Tasks and chat messages saved before the SupabaseStore fix have
-- workspace_id = null even when they came from a workspace, so they showed
-- only on the app owner's Tasks page. Re-stamp them from the audit log
-- (every queued task logs its workspace). Safe to re-run.

update tasks t
   set workspace_id = a.workspace_id
  from audit_log a
 where t.workspace_id is null
   and a.workspace_id is not null
   and a.action in ('task_queued', 'approval_required')
   and a.metadata->>'taskId' = t.id::text;

-- Assistant chat replies linked to a task follow that task.
update chat_messages c
   set workspace_id = t.workspace_id
  from tasks t
 where c.workspace_id is null
   and t.workspace_id is not null
   and c.task_id::text = t.id::text;
