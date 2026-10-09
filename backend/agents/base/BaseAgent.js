const { v4: uuid } = require('uuid');
const memory = require('../../memory');
const activityLog = require('../../core/activityLog');
const { selectProvider } = require('../../core/router');
const toolRegistry = require('../../tools/ToolRegistry');
const { businessContextLine } = require('../../core/businessContext');
const guidanceRegistry = require('../../core/guidanceRegistry');

/**
 * BaseAgent - common contract every specialized agent implements:
 * role, goals, memory, tools, planning, execution, reflection, logging.
 *
 * Every meaningful step emits a live activity event via activityLog.record -
 * this is what powers the Agent Activity Panel. Events only ever carry
 * structured metadata (tool names, providers, costs, step counts) - never
 * raw prompts or completions, so the panel is high-level by construction.
 *
 * Phase 2.3b: every emit, remember, reflection, and spawned approval task
 * now carries the parent task's workspace_id so the audit_log / agent_memory
 * / reflections / outreach_threads rows all stamp with the right workspace.
 */
class BaseAgent {
  constructor({ key, role, goals = [], tools = [] }) {
    this.key = key; // matches the agents/registry.js key, needed on spawned tasks
    this.role = role;
    this.goals = goals;
    this.tools = tools; // list of tool names this agent is allowed to call
  }

  async log(event, data = {}) {
    await activityLog.record(this.role, event, data.target || '', data);
  }

  /**
   * Spawns a new, independent pending_approval task - used when an agent's
   * own analysis (e.g. "these 3 emails need replies") produces further
   * irreversible actions that each need their own human approval, separate
   * from the task that discovered them.
   *
   * `outreach` is optional: when provided, registers a draft row in
   * outreach_threads keyed by this approval task so the Gmail guard /
   * inbox-triage filter can recognize the thread later. Pass
   * { recipientEmail, companyName?, campaign?, leadId? }.
   *
   * `workspaceId` (Phase 2.3b): when supplied by the caller (agents pass
   * `parentTask.workspace_id`), the new task row and the outreach_threads
   * row both get stamped with it. Falls back to null for legacy callers,
   * which the workspace shadow guard still logs for visibility.
   */
  async createApprovalTask({ instruction, tool, payload, outreach, workspaceId } = {}) {
    if (!this.tools.includes(tool)) {
      throw new Error(`${this.role} is not permitted to use tool "${tool}"`);
    }
    // Fall back to the parent task's workspace if the caller didn't supply
    // one. This covers the 15+ existing createApprovalTask call sites that
    // don't know to pass workspaceId - as long as they were reached from
    // inside this.run(parentTask), parentTask.workspace_id flows through
    // automatically without an invasive per-call-site refactor.
    const effectiveWorkspaceId = workspaceId || this._currentTask?.workspace_id || null;
    const task = {
      id: uuid(),
      agent: this.key,
      instruction,
      status: 'pending_approval',
      irreversible: true,
      toolCall: { tool, irreversible: true },
      payload,
      created_at: new Date().toISOString(),
      workspace_id: effectiveWorkspaceId,
    };
    await memory.saveTask(task, { workspaceId: effectiveWorkspaceId });
    await activityLog.record(this.role, 'approval_required', tool, { taskId: task.id, workspaceId: effectiveWorkspaceId });

    if (outreach && outreach.recipientEmail && typeof memory.createOutreachThread === 'function') {
      try {
        await memory.createOutreachThread({
          threadId: null, // filled in by guard.recordSentThread after the first successful send
          recipientEmail: outreach.recipientEmail,
          companyName: outreach.companyName || null,
          leadId: outreach.leadId || null,
          agentKey: this.key,
          campaign: outreach.campaign || null,
          outreachStatus: 'draft',
          approvedTaskId: task.id,
          workspace_id: effectiveWorkspaceId,
        }, { workspaceId: effectiveWorkspaceId });
      } catch {
        // Registry failure must not block the approval task itself - the
        // guard still enforces the approval requirement, just without a
        // registered thread until the first send.
      }
    }
    return task;
  }

  /** Break a task description into ordered steps. Subclasses override for real planning. */
  async plan(task) {
    return [{ type: 'llm_call', instruction: task.instruction }];
  }

  /** Run a single planned step. `priorContext` is the accumulated text from earlier steps in this task. */
  async execute(step, task, priorContext = '') {
    const workspaceId = task?.workspace_id || null;

    if (step.type === 'llm_call') {
      await activityLog.record(this.role, 'step_started', 'thinking', { taskId: task.id, stepType: 'llm_call', workspaceId });

      const provider = selectProvider(task);
      const prompt = priorContext
        ? `Context from previous steps:\n${priorContext}\n\n---\n\nNow: ${step.instruction}`
        : step.instruction;
      const guidance = guidanceRegistry.guidanceLine(step.instruction);
      const result = await provider.complete({
        prompt,
        system: `${businessContextLine()}${guidance}You are the ${this.role} inside CodeCraft AI. Be concise and actionable. If business context is provided above, use it instead of asking the user for it.`,
        maxTokens: step.maxTokens,
      });
      await activityLog.record(this.role, 'llm_call', provider.provider, {
        taskId: task.id,
        cost: result.costEstimate,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        status: 'done',
        workspaceId,
      });
      return result;
    }

    if (step.type === 'tool_call') {
      if (!this.tools.includes(step.tool)) {
        throw new Error(`${this.role} is not permitted to use tool "${step.tool}"`);
      }
      await activityLog.record(this.role, 'step_started', step.tool, { taskId: task.id, stepType: 'tool_call', workspaceId });

      // Any tool marked irreversible - whether a built-in plugin action or a
      // dynamically registered MCP tool - is deferred to human approval
      // instead of executed directly, the same way SalesAgent/SupportAgent
      // already hand-defer gmail.sendEmail and reddit.postComment. This is
      // the generic version of that same check, applied automatically to
      // every tool_call step rather than relying on each agent remembering
      // to gate it by hand.
      if (toolRegistry.isIrreversible(step.tool)) {
        const approvalTask = await this.createApprovalTask({
          instruction: `${this.role} wants to call "${step.tool}"`,
          tool: step.tool,
          payload: step.args,
          workspaceId,
        });
        await activityLog.record(this.role, 'tool_call', step.tool, {
          taskId: task.id,
          args: step.args,
          status: 'deferred_for_approval',
          approvalTaskId: approvalTask.id,
          workspaceId,
        });
        return { deferred: true, approvalTaskId: approvalTask.id, text: `Deferred "${step.tool}" for approval (task ${approvalTask.id}).` };
      }

      const result = await toolRegistry.call(step.tool, step.args, { role: this.role, workspaceId });
      await activityLog.record(this.role, 'tool_call', step.tool, {
        taskId: task.id,
        args: step.args,
        status: 'done',
        workspaceId,
      });
      return result;
    }

    throw new Error(`Unknown step type: ${step.type}`);
  }

  /** Self-critique after finishing a task; written to reflection memory. */
  async reflect(task, results) {
    const note = `Completed "${task.instruction}" in ${results.length} step(s).`;
    await memory.addReflection(this.role, task.id, note, { workspaceId: task?.workspace_id || null });
    return note;
  }

  /**
   * Full run loop: plan -> execute each step -> reflect.
   * Returns the task record with its final result.
   */
  async run(task) {
    const workspaceId = task?.workspace_id || null;
    // _currentTask lets createApprovalTask / reflect / remember fall back to
    // the parent task's workspace without every caller passing it. Cleared
    // in finally so a crashed run doesn't leak context into the next one.
    this._currentTask = task;
    await activityLog.record(this.role, 'task_started', this.key, { taskId: task.id, instruction: task.instruction, workspaceId });
    await memory.remember(this.role, { type: 'task_start', taskId: task.id, instruction: task.instruction, workspace_id: workspaceId });

    try {
      const steps = await this.plan(task);
      await activityLog.record(this.role, 'plan_created', this.key, { taskId: task.id, stepCount: steps.length, workspaceId });

      const results = [];
      let context = '';
      for (const step of steps) {
        const result = await this.execute(step, task, context);
        results.push(result);
        const resultText = result?.text || (result ? JSON.stringify(result) : '');
        if (resultText) context += `${context ? '\n\n' : ''}${resultText}`;
      }

      await this.reflect(task, results);
      await memory.remember(this.role, { type: 'task_end', taskId: task.id, workspace_id: workspaceId });
      await activityLog.record(this.role, 'task_completed', this.key, { taskId: task.id, stepCount: results.length, workspaceId });

      return results;
    } catch (err) {
      await activityLog.record(this.role, 'task_failed', this.key, { taskId: task.id, error: err.message, workspaceId });
      throw err;
    } finally {
      this._currentTask = null;
    }
  }
}

module.exports = BaseAgent;
