const { v4: uuid } = require('uuid');
const memory = require('../memory');
const activityLog = require('./activityLog');
const { selectProvider } = require('./router');
const toolRegistry = require('../tools/ToolRegistry');
const { agents } = require('../agents/registry');
const analytics = require('./analytics');

const TEMPLATE_PATTERN = /\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\s*\}\}/g;
const MAX_SUBWORKFLOW_DEPTH = 5; // guards against two workflows referencing each other and recursing forever

/** Replaces every {{ref.field}} in a string - node outputs ({{node_1.output}}) and loop variables ({{loop.item}}, {{loop.index}}) alike. */
function resolveTemplate(str, context) {
  if (typeof str !== 'string') return str;
  return str.replace(TEMPLATE_PATTERN, (match, refId, field) => {
    const value = context[refId]?.[field];
    return value !== undefined ? String(value) : match; // leave unresolved refs visible rather than silently blanking them
  });
}

/** Shallow-resolves every string value in a node's config object. */
function resolveConfig(config, context) {
  const resolved = {};
  for (const [key, value] of Object.entries(config || {})) {
    resolved[key] = typeof value === 'string' ? resolveTemplate(value, context) : value;
  }
  return resolved;
}

function toOutputString(result) {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    if (Array.isArray(result)) {
      const lastText = [...result].reverse().find((s) => s?.text)?.text;
      if (lastText) return lastText;
    }
    return JSON.stringify(result);
  }
  return String(result ?? '');
}

function edgesFrom(graph, nodeId) {
  return graph.edges.filter((e) => e.source === nodeId);
}

function nodeById(graph, nodeId) {
  return graph.nodes.find((n) => n.id === nodeId);
}

// Node types allowed inside a loop body or parallel branch. Deliberately
// excludes 'approval' (pausing mid-iteration/mid-branch needs much more
// complex state serialization - out of scope for this pass) and
// 'loop'/'parallel'/'sub_workflow' (bounds the complexity of nested state
// rather than attempting full recursive generality).
const NESTED_ALLOWED_TYPES = ['agent', 'tool', 'condition', 'switch'];

/**
 * Runs a small, self-contained sub-graph linearly (with condition/switch
 * branching support) starting from whichever of its nodes has no incoming
 * edge. Used by loop bodies and parallel branches - never by the top-level
 * run, which goes through walk() instead and supports pausing.
 */
async function runSubgraph(subgraph, parentContext, runId) {
  const localContext = { ...parentContext };
  const targetIds = new Set(subgraph.edges.map((e) => e.target));
  const startNode = subgraph.nodes.find((n) => !targetIds.has(n.id));
  if (!startNode) throw new Error('Sub-graph has no clear starting node (every node has an incoming edge)');

  let currentId = startNode.id;
  while (currentId) {
    const node = nodeById(subgraph, currentId);
    if (!node) throw new Error(`Sub-graph references unknown node "${currentId}"`);
    if (!NESTED_ALLOWED_TYPES.includes(node.type)) {
      throw new Error(`Node type "${node.type}" isn't allowed inside a loop body or parallel branch (only agent/tool/condition/switch)`);
    }

    const { output, branch } = await executeNode(node, localContext, runId);
    localContext[node.id] = { output };

    const nextEdge = pickNextEdge(subgraph, node.id, branch);
    currentId = nextEdge?.target || null;
  }

  return localContext;
}

/** Runs one node, returning its output string and (for branching nodes) which branch was taken. */
async function executeNode(node, context, runId) {
  const config = resolveConfig(node.config, context);
  await activityLog.record('workflow', 'node_started', node.id, { runId, nodeType: node.type });

  try {
    let output = '';
    let branch = null;

    if (node.type === 'trigger') {
      output = '';
    } else if (node.type === 'agent') {
      const agent = agents[config.agentKey];
      if (!agent) throw new Error(`Unknown agent "${config.agentKey}"`);
      // Mirrors the real orchestrator's save -> run -> update sequence
      // exactly (core/orchestrator/index.js) - agents assume they're being
      // run against an already-persisted task, since reflect() writes a
      // reflection row with a foreign key back to tasks(id).
      const task = {
        id: uuid(),
        instruction: config.goal,
        agent: config.agentKey,
        status: 'running',
        created_at: new Date().toISOString(),
      };
      await memory.saveTask(task);
      try {
        const results = await agent.run(task);
        await memory.updateTask(task.id, { status: 'done', result: results });
        output = toOutputString(results);
      } catch (err) {
        await memory.updateTask(task.id, { status: 'failed', result: { error: err.message } });
        throw err;
      }
    } else if (node.type === 'tool') {
      if (!toolRegistry.has(config.tool)) throw new Error(`Unknown tool "${config.tool}"`);
      const args = resolveConfig(config.args || {}, context);
      const result = await toolRegistry.call(config.tool, args, { role: 'workflow' });
      output = toOutputString(result);
    } else if (node.type === 'condition') {
      const provider = selectProvider({});
      const result = await provider.complete({
        maxTokens: 20,
        system: 'Answer with exactly one word: "yes" or "no". Nothing else.',
        prompt: config.question,
      });
      branch = result.text.toLowerCase().includes('yes') ? 'yes' : 'no';
      output = branch;
    } else if (node.type === 'switch') {
      branch = (config.value || '').trim();
      output = branch;
    } else if (node.type === 'decide') {
      // Self-initiated decision-making - picks from a CURATED menu the
      // workflow author defines, never fully open-ended. This is what
      // keeps "the system decides on its own" safe: it can only ever
      // choose among options you've explicitly vetted as safe/cheap to
      // run, not invent arbitrary new actions. Any parse failure or
      // unrecognized answer defaults to NONE rather than guessing into an
      // action - same safety-first philosophy as intentClassifier's
      // fallback behavior.
      const options = config.options || [];
      const optionList = options.map((o) => `- ${o.id}: ${o.label}`).join('\n');
      const recentActivity = await analytics.getRecentActivitySummary({ limit: 5 });
      const provider = selectProvider({});
      let chosen = 'NONE';
      try {
        const result = await provider.complete({
          maxTokens: 30,
          system:
            `Respond with ONLY a JSON object: {"choice": "..."} - the value must be exactly one of these ` +
            `option ids, or "NONE" if nothing here is genuinely worth doing right now:\n\n${optionList}\n\nNONE: nothing compelling right now`,
          prompt: `${recentActivity}\n\n${config.question || 'Given recent activity, is there something worth proactively doing?'}`,
        });
        const match = result.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.choice === 'NONE' || options.some((o) => o.id === parsed.choice)) {
            chosen = parsed.choice;
          }
        }
      } catch {
        chosen = 'NONE'; // any failure at all - network, parsing, whatever - defaults to doing nothing
      }
      branch = chosen;
      output = chosen;
    } else if (node.type === 'approval') {
      output = config.label || 'Approval checkpoint';
    } else if (node.type === 'loop') {
      const maxIterations = config.maxIterations || 20;
      let items;
      if (config.mode === 'count') {
        items = Array.from({ length: Math.min(config.count || 0, maxIterations) }, (_, i) => i);
      } else {
        // 'list' mode - one item per non-empty line, a predictable, simple
        // convention rather than requiring JSON-formatted agent output.
        items = (config.listExpression || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, maxIterations);
      }

      const iterationOutputs = [];
      for (let i = 0; i < items.length; i++) {
        await activityLog.record('workflow', 'loop_iteration_started', node.id, { runId, index: i, of: items.length });
        const iterContext = { ...context, loop: { item: String(items[i]), index: i } };
        const bodyContext = await runSubgraph(node.config.body, iterContext, runId);
        iterationOutputs.push(bodyContext[node.config.resultNodeId]?.output || '');
        await activityLog.record('workflow', 'loop_iteration_completed', node.id, { runId, index: i });
      }
      output = iterationOutputs.join('\n\n');
    } else if (node.type === 'parallel') {
      const branches = node.config.branches || [];
      await activityLog.record('workflow', 'parallel_started', node.id, { runId, branchCount: branches.length });
      const branchOutputs = await Promise.all(
        branches.map(async (branch, i) => {
          const bodyContext = await runSubgraph(branch.body, context, runId);
          return bodyContext[branch.resultNodeId]?.output || '';
        })
      );
      await activityLog.record('workflow', 'parallel_completed', node.id, { runId });
      output = branchOutputs.join('\n\n---\n\n');
    } else if (node.type === 'sub_workflow') {
      const depth = (context.__subworkflowDepth || 0) + 1;
      if (depth > MAX_SUBWORKFLOW_DEPTH) {
        throw new Error(`Sub-workflow nesting exceeded the max depth (${MAX_SUBWORKFLOW_DEPTH}) - check for a cycle between workflows`);
      }

      const subDefinition = await memory.getWorkflowDefinition(config.workflowId);
      if (!subDefinition) throw new Error(`Sub-workflow "${config.workflowId}" not found`);
      if (subDefinition.graph.nodes.some((n) => n.type === 'approval')) {
        throw new Error(`Sub-workflow "${subDefinition.name}" contains an approval node, which isn't supported when embedded in another workflow yet`);
      }
      const subTrigger = subDefinition.graph.nodes.find((n) => n.type === 'trigger');
      if (!subTrigger) throw new Error(`Sub-workflow "${subDefinition.name}" has no trigger node`);

      await activityLog.record('workflow', 'subworkflow_started', node.id, { runId, subWorkflowId: subDefinition.id });
      const subRun = {
        id: uuid(),
        workflowId: subDefinition.id,
        status: 'running',
        context: { __subworkflowDepth: depth },
        currentNodeId: null,
        pausedTaskId: null,
        error: null,
      };
      await memory.saveWorkflowRun(subRun);
      const subFirstEdge = pickNextEdge(subDefinition.graph, subTrigger.id, null);
      await walk(subRun, subDefinition, subFirstEdge?.target || null); // throws on failure, correctly propagating to the parent
      await activityLog.record('workflow', 'subworkflow_completed', node.id, { runId, subRunId: subRun.id });

      output = subRun.context[config.resultNodeId]?.output || '';
    } else {
      throw new Error(`Unknown node type "${node.type}"`);
    }

    await activityLog.record('workflow', 'node_completed', node.id, { runId, nodeType: node.type });
    return { output, branch };
  } catch (err) {
    await activityLog.record('workflow', 'node_failed', node.id, { runId, nodeType: node.type, error: err.message });
    throw err;
  }
}

/** Picks the next node to visit from a node's outgoing edges, respecting a branch if one was taken. */
function pickNextEdge(graph, nodeId, branch) {
  const candidates = edgesFrom(graph, nodeId);
  if (!branch) return candidates[0] || null;
  return candidates.find((e) => e.branch === branch) || candidates.find((e) => e.branch === 'default') || null;
}

/** Walks the graph from startNodeId until it finishes, pauses for approval, or fails. */
async function walk(run, definition, startNodeId) {
  const graph = definition.graph;
  let currentId = startNodeId;

  while (currentId) {
    const node = nodeById(graph, currentId);
    if (!node) throw new Error(`Graph references unknown node "${currentId}"`);

    if (node.type === 'approval') {
      const approvalConfig = resolveConfig(node.config, run.context);
      let preview;
      let previewType;
      if (approvalConfig.previewUrl) {
        preview = approvalConfig.previewUrl;
        previewType = approvalConfig.previewType || 'video';
      } else {
        const keys = Object.keys(run.context);
        preview = keys.length ? run.context[keys[keys.length - 1]]?.output : null;
        previewType = 'text';
      }
      const task = {
        id: uuid(),
        agent: 'workflow',
        instruction: node.config?.label || 'Workflow approval checkpoint',
        status: 'pending_approval',
        irreversible: true,
        toolCall: null,
        payload: { preview, previewType },
        workflowRunId: run.id,
        created_at: new Date().toISOString(),
      };
      await memory.saveTask(task);
      await memory.updateWorkflowRun(run.id, {
        status: 'paused_for_approval',
        currentNodeId: node.id,
        pausedTaskId: task.id,
        context: run.context,
      });
      await activityLog.record('workflow', 'run_paused', node.id, { runId: run.id, taskId: task.id });
      return; // stop here - resume() picks up from node.id's next edge later
    }

    const { output, branch } = await executeNode(node, run.context, run.id);
    run.context[node.id] = { output };
    await memory.updateWorkflowRun(run.id, { context: run.context, currentNodeId: node.id });

    const nextEdge = pickNextEdge(graph, node.id, branch);
    currentId = nextEdge?.target || null;
  }

  await memory.updateWorkflowRun(run.id, { status: 'done', completedAt: new Date().toISOString() });
  await activityLog.record('workflow', 'run_completed', definition.id, { runId: run.id });
}

/** Starts a fresh run of a workflow definition from its trigger node. */
/**
 * Starts a fresh run of a workflow definition from its trigger node.
 * @param {string} definitionId
 * @param {object} triggerOutput - optional data the trigger produced (e.g. a
 *   detected file path from a folder-watch trigger), seeded into the run's
 *   context as {{trigger.output}} for downstream nodes to reference.
 */
async function runWorkflow(definitionId, triggerOutput = null) {
  const definition = await memory.getWorkflowDefinition(definitionId);
  if (!definition) throw new Error(`Workflow definition "${definitionId}" not found`);

  const trigger = definition.graph.nodes.find((n) => n.type === 'trigger');
  if (!trigger) throw new Error('Workflow graph has no trigger node');

  const initialContext = triggerOutput !== null ? { trigger: { output: triggerOutput } } : {};
  const run = { id: uuid(), workflowId: definitionId, status: 'running', context: initialContext, currentNodeId: null, pausedTaskId: null, error: null };
  await memory.saveWorkflowRun(run);
  await activityLog.record('workflow', 'run_started', definitionId, { runId: run.id });

  const firstEdge = pickNextEdge(definition.graph, trigger.id, null);
  try {
    await walk(run, definition, firstEdge?.target || null);
  } catch (err) {
    await memory.updateWorkflowRun(run.id, { status: 'failed', error: err.message, completedAt: new Date().toISOString() });
    await activityLog.record('workflow', 'run_failed', definitionId, { runId: run.id, error: err.message });
  }

  return memory.getWorkflowRun(run.id);
}

/** Resumes a paused run after its approval task was approved. */
async function resumeWorkflow(runId) {
  const run = await memory.getWorkflowRun(runId);
  if (!run) throw new Error(`Workflow run "${runId}" not found`);
  if (run.status !== 'paused_for_approval') throw new Error(`Run "${runId}" is not paused (status: ${run.status})`);

  const definition = await memory.getWorkflowDefinition(run.workflowId);
  if (!definition) throw new Error(`Workflow definition "${run.workflowId}" not found`);

  await memory.updateWorkflowRun(runId, { status: 'running' });
  await activityLog.record('workflow', 'run_resumed', run.currentNodeId, { runId });

  const nextEdge = pickNextEdge(definition.graph, run.currentNodeId, null);
  try {
    await walk(run, definition, nextEdge?.target || null);
  } catch (err) {
    await memory.updateWorkflowRun(runId, { status: 'failed', error: err.message, completedAt: new Date().toISOString() });
    await activityLog.record('workflow', 'run_failed', definition.id, { runId, error: err.message });
  }

  return memory.getWorkflowRun(runId);
}

/** Cancels a paused run without resuming it (its approval task was rejected). */
async function cancelWorkflow(runId) {
  const run = await memory.getWorkflowRun(runId);
  if (!run) throw new Error(`Workflow run "${runId}" not found`);
  await memory.updateWorkflowRun(runId, { status: 'failed', error: 'Cancelled by user', completedAt: new Date().toISOString() });
  await activityLog.record('workflow', 'run_cancelled', run.currentNodeId, { runId });
  return memory.getWorkflowRun(runId);
}

module.exports = { runWorkflow, resumeWorkflow, cancelWorkflow, resolveTemplate, resolveConfig };
