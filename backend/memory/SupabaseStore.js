const { createClient } = require('@supabase/supabase-js');

/**
 * SupabaseStore
 *
 * Real persistence backing the same interface MemoryStore exposes in-memory.
 * Tables come from database/schema.sql: tasks, agent_memory, reflections, audit_log.
 */
class SupabaseStore {
  constructor({ url, serviceKey }) {
    this.client = createClient(url, serviceKey);
  }

  // --- Task memory ---
  async saveTask(task) {
    const { data, error } = await this.client
      .from('tasks')
      .insert({
        id: task.id,
        agent: task.agent,
        instruction: task.instruction,
        tool_call: task.toolCall || null,
        payload: task.payload || null,
        status: task.status,
        irreversible: !!task.irreversible,
        result: task.result || null,
        created_at: task.created_at,
      })
      .select()
      .single();

    if (error) throw new Error(`SupabaseStore.saveTask: ${error.message}`);
    return this._fromRow(data);
  }

  async getTask(id) {
    const { data, error } = await this.client.from('tasks').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseStore.getTask: ${error.message}`);
    return data ? this._fromRow(data) : null;
  }

  async updateTask(id, patch) {
    const row = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.result !== undefined) row.result = patch.result;
    if (patch.payload !== undefined) row.payload = patch.payload;
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.client.from('tasks').update(row).eq('id', id).select().maybeSingle();
    if (error) throw new Error(`SupabaseStore.updateTask: ${error.message}`);
    return data ? this._fromRow(data) : null;
  }

  async listTasks() {
    const { data, error } = await this.client.from('tasks').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseStore.listTasks: ${error.message}`);
    return (data || []).map((row) => this._fromRow(row));
  }

  async deleteTask(id) {
    const { error } = await this.client.from('tasks').delete().eq('id', id);
    if (error) throw new Error(`SupabaseStore.deleteTask: ${error.message}`);
    return true;
  }

  // Maps a DB row back to the shape the orchestrator/agents expect (camelCase toolCall).
  _fromRow(row) {
    return {
      id: row.id,
      agent: row.agent,
      instruction: row.instruction,
      toolCall: row.tool_call,
      payload: row.payload,
      status: row.status,
      irreversible: row.irreversible,
      result: row.result,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // --- Agent memory ---
  async remember(agentName, entry) {
    const { error } = await this.client.from('agent_memory').insert({ agent_name: agentName, entry });
    if (error) throw new Error(`SupabaseStore.remember: ${error.message}`);
  }

  async recall(agentName, limit = 20) {
    const { data, error } = await this.client
      .from('agent_memory')
      .select('entry, created_at')
      .eq('agent_name', agentName)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`SupabaseStore.recall: ${error.message}`);
    return (data || []).reverse().map((r) => ({ ...r.entry, at: r.created_at }));
  }

  // --- Reflection memory ---
  async addReflection(agentName, taskId, note) {
    const { error } = await this.client.from('reflections').insert({ agent_name: agentName, task_id: taskId, note });
    if (error) throw new Error(`SupabaseStore.addReflection: ${error.message}`);
  }

  // --- Audit log ---
  async audit(actor, action, target, metadata = {}) {
    const { error } = await this.client.from('audit_log').insert({ actor, action, target, metadata });
    if (error) throw new Error(`SupabaseStore.audit: ${error.message}`);
  }

  async getAuditLog(limit = 100) {
    const { data, error } = await this.client
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`SupabaseStore.getAuditLog: ${error.message}`);
    return (data || []).reverse().map((r) => ({ ...r, at: r.created_at }));
  }

  // --- Long-term memory (durable facts the user explicitly asks to remember) ---
  async addFact(fact) {
    const { randomUUID } = require('crypto');
    const { error } = await this.client.from('long_term_memory').insert({ id: randomUUID(), fact });
    if (error) throw new Error(`SupabaseStore.addFact: ${error.message}`);
  }

  async getFacts(limit = 50) {
    const { data, error } = await this.client
      .from('long_term_memory')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`SupabaseStore.getFacts: ${error.message}`);
    return (data || []).reverse().map((r) => ({ fact: r.fact, at: r.created_at }));
  }

  // --- Incoming WhatsApp messages (webhook dedup + record) ---
  async recordIncomingMessage(id, fromNumber, body) {
    const { data: existing } = await this.client.from('whatsapp_messages').select('id').eq('id', id).maybeSingle();
    if (existing) return { isNew: false };
    const { error } = await this.client.from('whatsapp_messages').insert({ id, from_number: fromNumber, body });
    if (error) throw new Error(`SupabaseStore.recordIncomingMessage: ${error.message}`);
    return { isNew: true };
  }

  // --- Installed skills (Universal Skill Installer) ---
  async saveSkill(skill) {
    const { error } = await this.client.from('skills').upsert({
      id: skill.id,
      name: skill.name,
      version: skill.version,
      author: skill.author,
      description: skill.description,
      manifest: skill.manifest,
      permissions: skill.permissions,
      status: skill.status,
      source_type: skill.sourceType,
      source_input: skill.sourceInput,
      source_path: skill.sourcePath,
      checksum: skill.checksum,
      installed_at: skill.installedAt,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`SupabaseStore.saveSkill: ${error.message}`);
    return skill;
  }

  async getSkill(id) {
    const { data, error } = await this.client.from('skills').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseStore.getSkill: ${error.message}`);
    return data ? this._skillFromRow(data) : null;
  }

  async listSkills() {
    const { data, error } = await this.client.from('skills').select('*').order('installed_at', { ascending: false });
    if (error) throw new Error(`SupabaseStore.listSkills: ${error.message}`);
    return (data || []).map((r) => this._skillFromRow(r));
  }

  async updateSkill(id, patch) {
    const row = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.version !== undefined) row.version = patch.version;
    if (patch.manifest !== undefined) row.manifest = patch.manifest;
    if (patch.permissions !== undefined) row.permissions = patch.permissions;
    if (patch.checksum !== undefined) row.checksum = patch.checksum;
    row.updated_at = new Date().toISOString();
    const { data, error } = await this.client.from('skills').update(row).eq('id', id).select().maybeSingle();
    if (error) throw new Error(`SupabaseStore.updateSkill: ${error.message}`);
    return data ? this._skillFromRow(data) : null;
  }

  async deleteSkill(id) {
    const { error } = await this.client.from('skills').delete().eq('id', id);
    if (error) throw new Error(`SupabaseStore.deleteSkill: ${error.message}`);
    return true;
  }

  _skillFromRow(row) {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      author: row.author,
      description: row.description,
      manifest: row.manifest,
      permissions: row.permissions,
      status: row.status,
      sourceType: row.source_type,
      sourceInput: row.source_input,
      sourcePath: row.source_path,
      checksum: row.checksum,
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
    };
  }

  // --- Workflows (scheduled recurring goals) ---
  async saveWorkflow(workflow) {
    const { error } = await this.client.from('scheduled_workflows').upsert({
      id: workflow.id,
      name: workflow.name,
      goal: workflow.goal,
      schedule_type: workflow.scheduleType,
      interval_minutes: workflow.intervalMinutes ?? null,
      daily_time: workflow.dailyTime ?? null,
      days_of_week: workflow.daysOfWeek ?? null,
      enabled: workflow.enabled,
      last_run_at: workflow.lastRunAt ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`SupabaseStore.saveWorkflow: ${error.message}`);
    return workflow;
  }

  async getWorkflow(id) {
    const { data, error } = await this.client.from('scheduled_workflows').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseStore.getWorkflow: ${error.message}`);
    return data ? this._workflowFromRow(data) : null;
  }

  async listWorkflows() {
    const { data, error } = await this.client.from('scheduled_workflows').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseStore.listWorkflows: ${error.message}`);
    return (data || []).map((r) => this._workflowFromRow(r));
  }

  async updateWorkflow(id, patch) {
    const row = {};
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.goal !== undefined) row.goal = patch.goal;
    if (patch.scheduleType !== undefined) row.schedule_type = patch.scheduleType;
    if (patch.intervalMinutes !== undefined) row.interval_minutes = patch.intervalMinutes;
    if (patch.dailyTime !== undefined) row.daily_time = patch.dailyTime;
    if (patch.daysOfWeek !== undefined) row.days_of_week = patch.daysOfWeek;
    if (patch.lastRunAt !== undefined) row.last_run_at = patch.lastRunAt;
    row.updated_at = new Date().toISOString();
    const { data, error } = await this.client.from('scheduled_workflows').update(row).eq('id', id).select().maybeSingle();
    if (error) throw new Error(`SupabaseStore.updateWorkflow: ${error.message}`);
    return data ? this._workflowFromRow(data) : null;
  }

  async deleteWorkflow(id) {
    const { error } = await this.client.from('scheduled_workflows').delete().eq('id', id);
    if (error) throw new Error(`SupabaseStore.deleteWorkflow: ${error.message}`);
    return true;
  }

  _workflowFromRow(row) {
    return {
      id: row.id,
      name: row.name,
      goal: row.goal,
      scheduleType: row.schedule_type,
      intervalMinutes: row.interval_minutes,
      dailyTime: row.daily_time,
      daysOfWeek: row.days_of_week,
      enabled: row.enabled,
      lastRunAt: row.last_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- Chat history (server-side persistence, survives refresh/device change) ---
  async addChatMessage(msg) {
    const { data, error } = await this.client
      .from('chat_messages')
      .insert({
        role: msg.role,
        content: msg.content,
        attachment_names: msg.attachmentNames || [],
        task_id: msg.taskId || null,
      })
      .select()
      .maybeSingle();
    if (error) throw new Error(`SupabaseStore.addChatMessage: ${error.message}`);
    return this._chatMessageFromRow(data);
  }

  async listChatMessages(limit = 200) {
    const { data, error } = await this.client
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`SupabaseStore.listChatMessages: ${error.message}`);
    return (data || []).reverse().map((r) => this._chatMessageFromRow(r));
  }

  _chatMessageFromRow(row) {
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      attachmentNames: row.attachment_names || [],
      taskId: row.task_id,
      createdAt: row.created_at,
    };
  }

  // --- Workflow definitions (graph-based workflow engine, Phase 1) ---
  async saveWorkflowDefinition(def) {
    const { error } = await this.client.from('workflow_definitions').upsert({
      id: def.id,
      name: def.name,
      graph: def.graph,
      enabled: def.enabled,
      schedule_type: def.scheduleType || null,
      interval_minutes: def.intervalMinutes ?? null,
      daily_time: def.dailyTime ?? null,
      days_of_week: def.daysOfWeek ?? null,
      watch_folder: def.watchFolder ?? null,
      last_run_at: def.lastRunAt ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`SupabaseStore.saveWorkflowDefinition: ${error.message}`);
    return def;
  }

  async getWorkflowDefinition(id) {
    const { data, error } = await this.client.from('workflow_definitions').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseStore.getWorkflowDefinition: ${error.message}`);
    return data ? this._workflowDefFromRow(data) : null;
  }

  async listWorkflowDefinitions() {
    const { data, error } = await this.client.from('workflow_definitions').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseStore.listWorkflowDefinitions: ${error.message}`);
    return (data || []).map((r) => this._workflowDefFromRow(r));
  }

  async updateWorkflowDefinition(id, patch) {
    const row = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.graph !== undefined) row.graph = patch.graph;
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    if (patch.scheduleType !== undefined) row.schedule_type = patch.scheduleType;
    if (patch.intervalMinutes !== undefined) row.interval_minutes = patch.intervalMinutes;
    if (patch.dailyTime !== undefined) row.daily_time = patch.dailyTime;
    if (patch.daysOfWeek !== undefined) row.days_of_week = patch.daysOfWeek;
    if (patch.watchFolder !== undefined) row.watch_folder = patch.watchFolder;
    if (patch.lastRunAt !== undefined) row.last_run_at = patch.lastRunAt;
    row.updated_at = new Date().toISOString();
    const { data, error } = await this.client.from('workflow_definitions').update(row).eq('id', id).select().maybeSingle();
    if (error) throw new Error(`SupabaseStore.updateWorkflowDefinition: ${error.message}`);
    return data ? this._workflowDefFromRow(data) : null;
  }

  async deleteWorkflowDefinition(id) {
    const { error } = await this.client.from('workflow_definitions').delete().eq('id', id);
    if (error) throw new Error(`SupabaseStore.deleteWorkflowDefinition: ${error.message}`);
    return true;
  }

  _workflowDefFromRow(row) {
    return {
      id: row.id,
      name: row.name,
      graph: row.graph,
      enabled: row.enabled,
      scheduleType: row.schedule_type,
      intervalMinutes: row.interval_minutes,
      dailyTime: row.daily_time,
      daysOfWeek: row.days_of_week,
      watchFolder: row.watch_folder,
      lastRunAt: row.last_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- Workflow runs (execution state, including paused-for-approval) ---
  async saveWorkflowRun(run) {
    const { error } = await this.client.from('workflow_runs').insert({
      id: run.id,
      workflow_id: run.workflowId,
      status: run.status,
      context: run.context || {},
      current_node_id: run.currentNodeId || null,
      paused_task_id: run.pausedTaskId || null,
      error: run.error || null,
    });
    if (error) throw new Error(`SupabaseStore.saveWorkflowRun: ${error.message}`);
    return run;
  }

  async getWorkflowRun(id) {
    const { data, error } = await this.client.from('workflow_runs').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseStore.getWorkflowRun: ${error.message}`);
    return data ? this._workflowRunFromRow(data) : null;
  }

  async updateWorkflowRun(id, patch) {
    const row = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.context !== undefined) row.context = patch.context;
    if (patch.currentNodeId !== undefined) row.current_node_id = patch.currentNodeId;
    if (patch.pausedTaskId !== undefined) row.paused_task_id = patch.pausedTaskId;
    if (patch.error !== undefined) row.error = patch.error;
    if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
    const { data, error } = await this.client.from('workflow_runs').update(row).eq('id', id).select().maybeSingle();
    if (error) throw new Error(`SupabaseStore.updateWorkflowRun: ${error.message}`);
    return data ? this._workflowRunFromRow(data) : null;
  }

  async listWorkflowRuns(workflowId) {
    let query = this.client.from('workflow_runs').select('*').order('started_at', { ascending: false });
    if (workflowId) query = query.eq('workflow_id', workflowId);
    const { data, error } = await query;
    if (error) throw new Error(`SupabaseStore.listWorkflowRuns: ${error.message}`);
    return (data || []).map((r) => this._workflowRunFromRow(r));
  }

  _workflowRunFromRow(row) {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status,
      context: row.context || {},
      currentNodeId: row.current_node_id,
      pausedTaskId: row.paused_task_id,
      error: row.error,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }
}

module.exports = SupabaseStore;
