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

  async getAuditLog() {
    const { data, error } = await this.client
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
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
}

module.exports = SupabaseStore;
