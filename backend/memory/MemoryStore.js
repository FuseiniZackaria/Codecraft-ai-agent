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

  async listTasks() {
    return Array.from(this.tasks.values());
  }

  async deleteTask(id) {
    return this.tasks.delete(id);
  }

  // --- Agent memory (per-agent scratchpad) ---
  async remember(agentName, entry) {
    if (!this.agentMemory.has(agentName)) this.agentMemory.set(agentName, []);
    this.agentMemory.get(agentName).push({ ...entry, at: new Date().toISOString() });
  }

  async recall(agentName, limit = 20) {
    return (this.agentMemory.get(agentName) || []).slice(-limit);
  }

  // --- Reflection memory ---
  async addReflection(agentName, taskId, note) {
    this.reflections.push({ agentName, taskId, note, at: new Date().toISOString() });
  }

  // --- Audit log ---
  async audit(actor, action, target, metadata = {}) {
    const { randomUUID } = require('crypto');
    this.auditLog.push({ id: randomUUID(), actor, action, target, metadata, at: new Date().toISOString() });
  }

  async getAuditLog() {
    return this.auditLog;
  }

  // --- Long-term memory (durable facts the user explicitly asks to remember) ---
  async addFact(fact) {
    if (!this.facts) this.facts = [];
    this.facts.push({ fact, at: new Date().toISOString() });
  }

  async getFacts(limit = 50) {
    return (this.facts || []).slice(-limit);
  }

  // --- Incoming WhatsApp messages (webhook dedup + record) ---
  async recordIncomingMessage(id, fromNumber, body) {
    if (!this.whatsappMessageIds) this.whatsappMessageIds = new Set();
    if (this.whatsappMessageIds.has(id)) return { isNew: false };
    this.whatsappMessageIds.add(id);
    return { isNew: true };
  }

  // --- Installed skills (Universal Skill Installer) ---
  async saveSkill(skill) {
    if (!this.skills) this.skills = new Map();
    this.skills.set(skill.id, { ...skill, updatedAt: new Date().toISOString() });
    return skill;
  }

  async getSkill(id) {
    return (this.skills && this.skills.get(id)) || null;
  }

  async listSkills() {
    return this.skills ? Array.from(this.skills.values()) : [];
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
}

module.exports = MemoryStore;
