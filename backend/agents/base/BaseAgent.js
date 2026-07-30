const { v4: uuid } = require('uuid');
const memory = require('../../memory');
const activityLog = require('../../core/activityLog');
const { selectProvider } = require('../../core/router');
const toolRegistry = require('../../tools/ToolRegistry');
const { businessContextLine } = require('../../core/businessContext');

/**
 * BaseAgent - common contract every specialized agent implements:
 * role, goals, memory, tools, planning, execution, reflection, logging.
 *
 * Every meaningful step emits a live activity event via activityLog.record -
 * this is what powers the Agent Activity Panel. Events only ever carry
 * structured metadata (tool names, providers, costs, step counts) - never
 * raw prompts or completions, so the panel is high-level by construction.
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
   */
  async createApprovalTask({ instruction, tool, payload }) {
    if (!this.tools.includes(tool)) {
      throw new Error(`${this.role} is not permitted to use tool "${tool}"`);
    }
    const task = {
      id: uuid(),
      agent: this.key,
      instruction,
      status: 'pending_approval',
      irreversible: true,
      toolCall: { tool, irreversible: true },
      payload,
      created_at: new Date().toISOString(),
    };
    await memory.saveTask(task);
    await activityLog.record(this.role, 'approval_required', tool, { taskId: task.id });
    return task;
  }

  /** Break a task description into ordered steps. Subclasses override for real planning. */
  async plan(task) {
    return [{ type: 'llm_call', instruction: task.instruction }];
  }

  /** Run a single planned step. `priorContext` is the accumulated text from earlier steps in this task. */
  async execute(step, task, priorContext = '') {
    if (step.type === 'llm_call') {
      await activityLog.record(this.role, 'step_started', 'thinking', { taskId: task.id, stepType: 'llm_call' });

      const provider = selectProvider(task);
      const prompt = priorContext
        ? `Context from previous steps:\n${priorContext}\n\n---\n\nNow: ${step.instruction}`
        : step.instruction;
      const result = await provider.complete({
        prompt,
        system: `${businessContextLine()}You are the ${this.role} inside CodeCraft AI. Be concise and actionable. If business context is provided above, use it instead of asking the user for it.`,
        maxTokens: step.maxTokens,
      });
      await activityLog.record(this.role, 'llm_call', provider.provider, {
        taskId: task.id,
        cost: result.costEstimate,
        status: 'done',
      });
      return result;
    }

    if (step.type === 'tool_call') {
      if (!this.tools.includes(step.tool)) {
        throw new Error(`${this.role} is not permitted to use tool "${step.tool}"`);
      }
      await activityLog.record(this.role, 'step_started', step.tool, { taskId: task.id, stepType: 'tool_call' });

      const result = await toolRegistry.call(step.tool, step.args, { role: this.role });
      await activityLog.record(this.role, 'tool_call', step.tool, {
        taskId: task.id,
        args: step.args,
        status: 'done',
      });
      return result;
    }

    throw new Error(`Unknown step type: ${step.type}`);
  }

  /** Self-critique after finishing a task; written to reflection memory. */
  async reflect(task, results) {
    const note = `Completed "${task.instruction}" in ${results.length} step(s).`;
    await memory.addReflection(this.role, task.id, note);
    return note;
  }

  /**
   * Full run loop: plan -> execute each step -> reflect.
   * Returns the task record with its final result.
   */
  async run(task) {
    await activityLog.record(this.role, 'task_started', this.key, { taskId: task.id, instruction: task.instruction });
    await memory.remember(this.role, { type: 'task_start', taskId: task.id, instruction: task.instruction });

    try {
      const steps = await this.plan(task);
      await activityLog.record(this.role, 'plan_created', this.key, { taskId: task.id, stepCount: steps.length });

      const results = [];
      let context = '';
      for (const step of steps) {
        const result = await this.execute(step, task, context);
        results.push(result);
        const resultText = result?.text || (result ? JSON.stringify(result) : '');
        if (resultText) context += `${context ? '\n\n' : ''}${resultText}`;
      }

      await this.reflect(task, results);
      await memory.remember(this.role, { type: 'task_end', taskId: task.id });
      await activityLog.record(this.role, 'task_completed', this.key, { taskId: task.id, stepCount: results.length });

      return results;
    } catch (err) {
      await activityLog.record(this.role, 'task_failed', this.key, { taskId: task.id, error: err.message });
      throw err;
    }
  }
}

module.exports = BaseAgent;
