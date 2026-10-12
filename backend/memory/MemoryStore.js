/**
 * MemoryStore
 *
 * In-memory implementation of the memory architecture from the design doc
 * (short-term, agent, task, reflection layers). Methods are async to match
 * the SupabaseStore interface exactly, so callers never know or care which
 * backing store is active.
 */
class MemoryStore {
  constructor() {
    this.tasks = new Map();
    this.agentMemory = new Map(); // agentName -> array of entries
    this.reflections = [];
    this.auditLog = [];
  }

  // --- Task memory ---
  async saveTask(task) {
    this.tasks.set(task.id, task);
    return task;
  }

  async getTask(id) {
    return this.tasks.get(id) || null;
  }

  async updateTask(id, patch) {
    const task = this.tasks.get(id);
    if (!task) return null;
    const updated = { ...task, ...patch, updated_at: new Date().toISOString() };
    this.tasks.set(id, updated);
    return updated;
  }

  async listTasks(options = {}) {
    const ws = options.workspaceId || options.workspace_id || null;
    const all = Array.from(this.tasks.values());
    return ws ? all.filter((t) => !t.workspace_id || t.workspace_id === ws) : all;
  }

  async deleteTask(id) {
    return this.tasks.delete(id);
  }

  async markAllTasksRead() {
    for (const task of this.tasks.values()) task.read = true;
    return true;
  }

  // --- Agent memory (per-agent scratchpad) ---
  async remember(agentName, entry) {
    if (!this.agentMemory.has(agentName)) this.agentMemory.set(agentName, []);
    // Entry may carry workspace_id / workspaceId; both are stamped so the
    // in-memory shape matches what SupabaseStore writes to the row.
    const workspace_id = entry?.workspace_id || entry?.workspaceId || null;
    this.agentMemory.get(agentName).push({ ...entry, workspace_id, at: new Date().toISOString() });
  }

  async recall(agentName, limit = 20) {
    return (this.agentMemory.get(agentName) || []).slice(-limit);
  }

  // --- Reflection memory ---
  async addReflection(agentName, taskId, note, options = {}) {
    this.reflections.push({
      agentName,
      taskId,
      note,
      workspace_id: options.workspaceId || null,
      at: new Date().toISOString(),
    });
  }

  // --- Audit log ---
  async audit(actor, action, target, metadata = {}) {
    const { randomUUID } = require('crypto');
    // workspace_id is a first-class column, peeled off from metadata so the
    // audit row carries it even if the metadata JSON is renamed later.
    const workspace_id = metadata?.workspaceId || metadata?.workspace_id || null;
    this.auditLog.push({
      id: randomUUID(),
      actor,
      action,
      target,
      workspace_id,
      metadata,
      at: new Date().toISOString(),
    });
  }

  async getAuditLog(limit, options = {}) {
    const ws = options.workspaceId || options.workspace_id || null;
    const scoped = ws
      ? this.auditLog.filter((e) => !e.workspace_id || e.workspace_id === ws)
      : this.auditLog;
    return limit ? scoped.slice(-limit) : scoped;
  }

  // --- Long-term memory (durable facts the user explicitly asks to remember) ---
  async addFact(fact, options = {}) {
    if (!this.facts) this.facts = [];
    const workspace_id = options.workspaceId || options.workspace_id || null;
    this.facts.push({ fact, workspace_id, at: new Date().toISOString() });
  }

  // Legacy (workspace_id = null) facts stay visible to every workspace,
  // matching the SupabaseStore behavior.
  async getFacts(limit = 50, options = {}) {
    const ws = options.workspaceId || options.workspace_id || null;
    const all = this.facts || [];
    const scoped = ws ? all.filter((f) => !f.workspace_id || f.workspace_id === ws) : all;
    return scoped.slice(-limit);
  }

  // --- Incoming WhatsApp messages (webhook dedup + record) ---
  async recordIncomingMessage(id, fromNumber, body) {
    if (!this.whatsappMessageIds) this.whatsappMessageIds = new Set();
    if (this.whatsappMessageIds.has(id)) return { isNew: false };
    this.whatsappMessageIds.add(id);
    return { isNew: true };
  }

    async recordIncomingTelegramMessage(id, fromChatId, body) {
    if (!this.telegramMessageIds) this.telegramMessageIds = new Set();
    if (this.telegramMessageIds.has(id)) return { isNew: false };
    this.telegramMessageIds.add(id);
    return { isNew: true };
  }

  // --- Installed skills (Universal Skill Installer) ---
  async saveSkill(skill) {
    if (!this.skills) this.skills = new Map();
    const workspace_id = skill.workspace_id || skill.workspaceId || null;
    this.skills.set(skill.id, { ...skill, workspace_id, updatedAt: new Date().toISOString() });
    return skill;
  }

  async getSkill(id) {
    return (this.skills && this.skills.get(id)) || null;
  }

  async listSkills(options = {}) {
    if (!this.skills) return [];
    const ws = options.workspaceId || options.workspace_id || null;
    const all = Array.from(this.skills.values());
    return ws ? all.filter((s) => !s.workspace_id || s.workspace_id === ws) : all;
  }

  async updateSkill(id, patch) {
    const existing = await this.getSkill(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.skills.set(id, updated);
    return updated;
  }

  async deleteSkill(id) {
    return this.skills ? this.skills.delete(id) : false;
  }

  // --- Workflows (scheduled recurring goals) ---
  async saveWorkflow(workflow) {
    if (!this.workflows) this.workflows = new Map();
    const workspace_id = workflow.workspace_id || workflow.workspaceId || null;
    this.workflows.set(workflow.id, { ...workflow, workspace_id, updatedAt: new Date().toISOString() });
    return workflow;
  }

  async getWorkflow(id) {
    return (this.workflows && this.workflows.get(id)) || null;
  }

  async listWorkflows(options = {}) {
    if (!this.workflows) return [];
    const ws = options.workspaceId || options.workspace_id || null;
    const all = Array.from(this.workflows.values());
    return ws ? all.filter((w) => !w.workspace_id || w.workspace_id === ws) : all;
  }

  async updateWorkflow(id, patch) {
    const existing = await this.getWorkflow(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.workflows.set(id, updated);
    return updated;
  }

  async deleteWorkflow(id) {
    return this.workflows ? this.workflows.delete(id) : false;
  }

  // --- Chat history (server-side persistence, survives refresh/device change) ---
  async addChatMessage(msg) {
    if (!this.chatMessages) this.chatMessages = [];
    const workspace_id = msg.workspace_id || msg.workspaceId || null;
    const stored = { id: require('crypto').randomUUID(), ...msg, workspace_id, createdAt: new Date().toISOString() };
    this.chatMessages.push(stored);
    return stored;
  }

  async listChatMessages(limit = 200, options = {}) {
    if (!this.chatMessages) return [];
    const ws = options.workspaceId || options.workspace_id || null;
    const scoped = ws ? this.chatMessages.filter((m) => !m.workspace_id || m.workspace_id === ws) : this.chatMessages;
    return scoped.slice(-limit);
  }

  // --- Assistant daily usage (soft cost cap) ---
  async getAssistantUsage(day) {
    if (!this.assistantUsage) this.assistantUsage = new Map();
    return this.assistantUsage.get(day) || null;
  }

  async upsertAssistantUsage(day, row) {
    if (!this.assistantUsage) this.assistantUsage = new Map();
    this.assistantUsage.set(day, { day, ...row });
    return true;
  }

  // --- Workflow definitions (graph-based workflow engine, Phase 1) ---
  async saveWorkflowDefinition(def) {
    if (!this.workflowDefinitions) this.workflowDefinitions = new Map();
    const workspace_id = def.workspace_id || def.workspaceId || null;
    this.workflowDefinitions.set(def.id, { ...def, workspace_id, updatedAt: new Date().toISOString() });
    return def;
  }

  async getWorkflowDefinition(id) {
    return (this.workflowDefinitions && this.workflowDefinitions.get(id)) || null;
  }

  async listWorkflowDefinitions(options = {}) {
    if (!this.workflowDefinitions) return [];
    const ws = options.workspaceId || options.workspace_id || null;
    const all = Array.from(this.workflowDefinitions.values());
    return ws ? all.filter((d) => !d.workspace_id || d.workspace_id === ws) : all;
  }

  async updateWorkflowDefinition(id, patch) {
    const existing = await this.getWorkflowDefinition(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.workflowDefinitions.set(id, updated);
    return updated;
  }

  async deleteWorkflowDefinition(id) {
    return this.workflowDefinitions ? this.workflowDefinitions.delete(id) : false;
  }

  // --- Workflow runs (execution state, including paused-for-approval) ---
  async saveWorkflowRun(run) {
    if (!this.workflowRuns) this.workflowRuns = new Map();
    const workspace_id = run.workspace_id || run.workspaceId || null;
    this.workflowRuns.set(run.id, { ...run, workspace_id });
    return run;
  }

  async getWorkflowRun(id) {
    return (this.workflowRuns && this.workflowRuns.get(id)) || null;
  }

  async updateWorkflowRun(id, patch) {
    const existing = await this.getWorkflowRun(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.workflowRuns.set(id, updated);
    return updated;
  }

  async listWorkflowRuns(workflowId) {
    if (!this.workflowRuns) return [];
    return Array.from(this.workflowRuns.values()).filter((r) => !workflowId || r.workflowId === workflowId);
  }

  // --- Outreach threads (see schema.sql for the full rationale) ---
  async createOutreachThread(row) {
    if (!this.outreachThreads) this.outreachThreads = new Map();
    const { randomUUID } = require('crypto');
    const stored = {
      id: row.id || randomUUID(),
      threadId: row.threadId || null,
      recipientEmail: (row.recipientEmail || '').toLowerCase(),
      companyName: row.companyName || null,
      leadId: row.leadId || null,
      agentKey: row.agentKey,
      campaign: row.campaign || null,
      outreachStatus: row.outreachStatus || 'draft',
      lastMessageId: row.lastMessageId || null,
      approvedTaskId: row.approvedTaskId || null,
      workspace_id: row.workspace_id || row.workspaceId || null,
      metadata: row.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.outreachThreads.set(stored.id, stored);
    return stored;
  }

  async getOutreachThreadByThreadId(threadId) {
    if (!this.outreachThreads || !threadId) return null;
    for (const row of this.outreachThreads.values()) {
      if (row.threadId === threadId) return row;
    }
    return null;
  }

  async getOutreachThreadByApprovedTask(taskId) {
    if (!this.outreachThreads || !taskId) return null;
    for (const row of this.outreachThreads.values()) {
      if (row.approvedTaskId === taskId) return row;
    }
    return null;
  }

  async listOutreachThreadsByRecipient(email) {
    if (!this.outreachThreads || !email) return [];
    const target = email.toLowerCase();
    return Array.from(this.outreachThreads.values()).filter((r) => r.recipientEmail === target);
  }

  async updateOutreachThread(id, patch) {
    if (!this.outreachThreads) return null;
    const existing = this.outreachThreads.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    if (patch.recipientEmail) updated.recipientEmail = patch.recipientEmail.toLowerCase();
    this.outreachThreads.set(id, updated);
    return updated;
  }

  async listOutreachThreads() {
    return this.outreachThreads ? Array.from(this.outreachThreads.values()) : [];
  }

  // --- Briefing runs (memory across BriefingAgent runs, for trend comparison) ---
  async saveBriefingRun(run) {
    if (!this.briefingRuns) this.briefingRuns = [];
    const { randomUUID } = require('crypto');
    const workspace_id = run.workspace_id || run.workspaceId || null;
    const stored = { id: randomUUID(), workflowId: null, ...run, workspace_id, createdAt: new Date().toISOString() };
    this.briefingRuns.push(stored);
    return stored;
  }

  async getLatestBriefingRun(goal, options = {}) {
    if (!this.briefingRuns) return null;
    const ws = options.workspaceId || options.workspace_id || null;
    const matches = this.briefingRuns
      .filter((r) => r.goal === goal && (!ws || !r.workspace_id || r.workspace_id === ws))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return matches[0] || null;
  }

  // --- Briefing articles (dashboard-facing) ---
  async saveBriefingArticles(articles, options = {}) {
    if (!this.briefingArticles) this.briefingArticles = [];
    const fallbackWs = options.workspaceId || options.workspace_id || null;
    const stored = (articles || []).map((a) => ({
      ...a,
      workspace_id: a.workspace_id || a.workspaceId || fallbackWs || null,
      collectedAt: new Date().toISOString(),
    }));
    this.briefingArticles.push(...stored);
    return stored;
  }

  async getBriefingArticles(workflowGoal, { sinceDays, workspaceId, workspace_id } = {}) {
    if (!this.briefingArticles) return [];
    const ws = workspaceId || workspace_id || null;
    const sinceMs = sinceDays ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;
    return this.briefingArticles.filter((a) => {
      if (a.workflowGoal !== workflowGoal) return false;
      if (sinceMs && new Date(a.collectedAt).getTime() < sinceMs) return false;
      if (ws && a.workspace_id && a.workspace_id !== ws) return false;
      return true;
    });
  }

  // --- Business profile (Phase 2.4) ---
  //
  // One row per workspace, keyed by workspace_id. Shape mirrors the
  // business_profile Supabase table exactly so a swap between stores is
  // behaviour-identical. Returns null when no row exists for the workspace,
  // and callers fall back to legacy env/business.json defaults.
  async getBusinessProfile({ workspaceId, workspace_id } = {}) {
    const ws = workspaceId || workspace_id || null;
    if (!ws) return null;
    if (!this.businessProfiles) this.businessProfiles = new Map();
    return this.businessProfiles.get(ws) || null;
  }

  async updateBusinessProfile(patch = {}, { workspaceId, workspace_id } = {}) {
    const ws = workspaceId || workspace_id || patch?.workspace_id || null;
    if (!ws) throw new Error('MemoryStore.updateBusinessProfile requires a workspaceId');
    if (!this.businessProfiles) this.businessProfiles = new Map();
    const existing = this.businessProfiles.get(ws) || { workspace_id: ws };
    const merged = { ...existing, ...patch, workspace_id: ws, updated_at: new Date().toISOString() };
    this.businessProfiles.set(ws, merged);
    return merged;
  }

  // --- Workspace connections (Phase 2.5) ---
  async getWorkspaceConnection(workspaceId, provider) {
    if (!workspaceId || !provider) return null;
    if (!this._connections) this._connections = new Map();
    return this._connections.get(`${workspaceId}:${provider}`) || null;
  }

  async listWorkspaceConnections(workspaceId) {
    if (!workspaceId) return [];
    if (!this._connections) this._connections = new Map();
    return Array.from(this._connections.values()).filter((c) => c.workspace_id === workspaceId);
  }

  async upsertWorkspaceConnection(workspaceId, provider, data) {
    if (!workspaceId || !provider) throw new Error('workspaceId and provider required');
    if (!this._connections) this._connections = new Map();
    const key = `${workspaceId}:${provider}`;
    const existing = this._connections.get(key) || {};
    const { randomUUID } = require('crypto');
    const merged = {
      id: existing.id || randomUUID(),
      workspace_id: workspaceId,
      provider,
      ...existing,
      ...data,
      updated_at: new Date().toISOString(),
    };
    if (!merged.created_at) merged.created_at = merged.updated_at;
    this._connections.set(key, merged);
    return merged;
  }

  async deleteWorkspaceConnection(workspaceId, provider) {
    if (!this._connections) return true;
    this._connections.delete(`${workspaceId}:${provider}`);
    return true;
  }

  async findConnectionByWebhookToken(provider, webhookToken) {
    if (!this._connections || !webhookToken) return null;
    for (const conn of this._connections.values()) {
      if (conn.provider === provider && conn.provider_meta?.webhook_token === webhookToken) return conn;
    }
    return null;
  }
}

module.exports = MemoryStore;