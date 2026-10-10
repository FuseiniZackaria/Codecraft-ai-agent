const express = require('express');
const { v4: uuid } = require('uuid');
const memory = require('../memory');
const workflowEngine = require('../core/workflowEngine');
const { WorkflowRegistry } = require('../core/workflowRegistry');

const router = express.Router();
const registry = new WorkflowRegistry();

function validateGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return 'graph must have "nodes" and "edges" arrays';
  }
  if (!graph.nodes.some((n) => n.type === 'trigger')) {
    return 'graph must have at least one trigger node';
  }
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) return `edge references unknown source node "${edge.source}"`;
    if (!nodeIds.has(edge.target)) return `edge references unknown target node "${edge.target}"`;
  }
  return null;
}

// --- Registry / marketplace browsing (declared before /:id so "registry" never matches as an id) ---

router.get('/registry/search', (req, res) => {
  try {
    res.json(registry.search(req.query.q || ''));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/registry/categories', (req, res) => {
  try {
    res.json(registry.listCategories());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/registry/:id', (req, res) => {
  try {
    res.json(registry.getDetails(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/registry/:id/install', async (req, res) => {
  try {
    const entry = registry.getDetails(req.params.id);
    const graphError = validateGraph(entry.graph);
    if (graphError) return res.status(500).json({ error: `Registry entry has an invalid graph: ${graphError}` });

    const workspaceId = req.user?.workspaceId || null;
    const definition = {
      id: uuid(),
      name: entry.name,
      graph: entry.graph,
      enabled: true,
      scheduleType: null,
      intervalMinutes: null,
      dailyTime: null,
      daysOfWeek: null,
      lastRunAt: null,
      workspace_id: workspaceId,
      createdAt: new Date().toISOString(),
    };
    await memory.saveWorkflowDefinition(definition, { workspaceId });
    res.status(201).json(definition);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const ws = req.user?.workspaceId;
    const all = await memory.listWorkflowDefinitions({ workspaceId: ws || null });
    const scoped = ws ? (all || []).filter((w) => !w.workspace_id || w.workspace_id === ws) : all;
    res.json(scoped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const graphError = validateGraph(req.body.graph);
  if (graphError) return res.status(400).json({ error: graphError });
  if (!req.body.name) return res.status(400).json({ error: 'name is required' });
  if (req.body.scheduleType === 'folder_watch' && !req.body.watchFolder) {
    return res.status(400).json({ error: 'watchFolder is required when scheduleType is "folder_watch"' });
  }

  try {
    const workspaceId = req.user?.workspaceId || null;
    const definition = {
      id: uuid(),
      name: req.body.name,
      graph: req.body.graph,
      enabled: req.body.enabled !== false,
      scheduleType: req.body.scheduleType || null,
      intervalMinutes: req.body.intervalMinutes || null,
      dailyTime: req.body.dailyTime || null,
      daysOfWeek: req.body.daysOfWeek || null,
      watchFolder: req.body.watchFolder || null,
      lastRunAt: null,
      workspace_id: workspaceId,
      createdAt: new Date().toISOString(),
    };
    await memory.saveWorkflowDefinition(definition, { workspaceId });
    res.status(201).json(definition);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// scopeOne returns the row if the caller's workspace can see it (same
// workspace, or legacy null-workspace row), else null - so a direct GET
// /:id by UUID can't peek into another workspace's data.
function scopeOne(row, req) {
  if (!row) return null;
  const ws = req.user?.workspaceId;
  if (!ws) return row;
  if (!row.workspace_id || row.workspace_id === ws) return row;
  return null;
}

router.get('/:id', async (req, res) => {
  try {
    const def = scopeOne(await memory.getWorkflowDefinition(req.params.id), req);
    if (!def) return res.status(404).json({ error: 'Workflow definition not found' });
    res.json(def);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = scopeOne(await memory.getWorkflowDefinition(req.params.id), req);
    if (!existing) return res.status(404).json({ error: 'Workflow definition not found' });

    if (req.body.graph !== undefined) {
      const graphError = validateGraph(req.body.graph);
      if (graphError) return res.status(400).json({ error: graphError });
    }

    const patch = {};
    for (const field of ['name', 'graph', 'enabled', 'scheduleType', 'intervalMinutes', 'dailyTime', 'daysOfWeek', 'watchFolder']) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }
    res.json(await memory.updateWorkflowDefinition(req.params.id, patch));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = scopeOne(await memory.getWorkflowDefinition(req.params.id), req);
    if (!existing) return res.status(404).json({ error: 'Workflow definition not found' });
    await memory.deleteWorkflowDefinition(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/runs', async (req, res) => {
  try {
    // Scope at the definition level: if the definition doesn't belong to
    // this workspace, the runs under it don't either.
    const parent = scopeOne(await memory.getWorkflowDefinition(req.params.id), req);
    if (!parent) return res.status(404).json({ error: 'Workflow definition not found' });
    const runs = await memory.listWorkflowRuns(req.params.id);
    const ws = req.user?.workspaceId;
    const scoped = ws ? (runs || []).filter((r) => !r.workspace_id || r.workspace_id === ws) : runs;
    res.json(scoped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/run', async (req, res) => {
  try {
    const run = await workflowEngine.runWorkflow(req.params.id);
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/runs/:runId/resume', async (req, res) => {
  try {
    res.json(await workflowEngine.resumeWorkflow(req.params.runId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/runs/:runId/cancel', async (req, res) => {
  try {
    res.json(await workflowEngine.cancelWorkflow(req.params.runId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/runs/:runId', async (req, res) => {
  try {
    const run = await memory.getWorkflowRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Workflow run not found' });
    const ws = req.user?.workspaceId;
    if (ws && run.workspace_id && run.workspace_id !== ws) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
