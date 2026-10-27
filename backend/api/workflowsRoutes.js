const express = require('express');
const { v4: uuid } = require('uuid');
const memory = require('../memory');
const scheduler = require('../core/scheduler');
const { canSeeLegacy, rowVisible } = require('../core/workspaceContext');

// Only the caller's own rows; rows with no workspace_id (legacy) only for the
// app owner's workspace. A request with no workspace sees nothing.
async function visibleList(rows, req) {
  const ws = req.user?.workspaceId;
  if (!ws) return [];
  const legacyOk = await canSeeLegacy(ws);
  return (rows || []).filter((r) => rowVisible(r, ws, legacyOk));
}

async function visibleOne(row, req) {
  const ws = req.user?.workspaceId;
  if (!row || !ws) return null;
  return rowVisible(row, ws, await canSeeLegacy(ws)) ? row : null;
}

const router = express.Router();

const VALID_SCHEDULE_TYPES = ['interval', 'daily'];

function validateWorkflowInput(body) {
  if (!body.name || !body.goal) return 'name and goal are required';
  if (!VALID_SCHEDULE_TYPES.includes(body.scheduleType)) return `scheduleType must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}`;
  if (body.scheduleType === 'interval' && (!body.intervalMinutes || body.intervalMinutes <= 0)) {
    return 'intervalMinutes must be a positive number for an interval schedule';
  }
  if (body.scheduleType === 'daily' && !/^\d{2}:\d{2}$/.test(body.dailyTime || '')) {
    return 'dailyTime must be in HH:MM format for a daily schedule';
  }
  return null;
}

router.get('/', async (req, res) => {
  try {
    // Phase 2.3b: scope to the admin's workspace. Rows without workspace_id
    // (legacy backfill or absent column pre-migration) are still returned so
    // nothing disappears on existing deployments; Phase 2.3c tightens.
    const ws = req.user?.workspaceId;
    const all = await memory.listWorkflows({ workspaceId: ws || null });
    const scoped = await visibleList(all, req);
    res.json(scoped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const validationError = validateWorkflowInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const workspaceId = req.user?.workspaceId || null;
    const workflow = {
      id: uuid(),
      name: req.body.name,
      goal: req.body.goal,
      scheduleType: req.body.scheduleType,
      intervalMinutes: req.body.scheduleType === 'interval' ? Number(req.body.intervalMinutes) : null,
      dailyTime: req.body.scheduleType === 'daily' ? req.body.dailyTime : null,
      daysOfWeek: req.body.scheduleType === 'daily' ? req.body.daysOfWeek || null : null,
      enabled: req.body.enabled !== false,
      deliverWhatsappEnabled: req.body.deliverWhatsappEnabled === true,
      deliverWhatsappTo: req.body.deliverWhatsappEnabled ? req.body.deliverWhatsappTo || null : null,
      lastRunAt: null,
      workspace_id: workspaceId,
      createdAt: new Date().toISOString(),
    };
    await memory.saveWorkflow(workflow, { workspaceId });
    res.status(201).json(workflow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await visibleOne(await memory.getWorkflow(req.params.id), req);
    if (!existing) return res.status(404).json({ error: 'Workflow not found' });

    const patch = {};
    for (const field of ['name', 'goal', 'scheduleType', 'intervalMinutes', 'dailyTime', 'daysOfWeek', 'enabled', 'deliverWhatsappEnabled', 'deliverWhatsappTo']) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }
    const workspaceId = req.user?.workspaceId || existing.workspace_id || null;
    const updated = await memory.updateWorkflow(req.params.id, patch, { workspaceId });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await visibleOne(await memory.getWorkflow(req.params.id), req);
    if (!existing) return res.status(404).json({ error: 'Workflow not found' });
    const workspaceId = req.user?.workspaceId || existing?.workspace_id || null;
    await memory.deleteWorkflow(req.params.id, { workspaceId });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a workflow right now, outside its normal schedule - useful for testing a workflow works before trusting it to run unattended.
router.post('/:id/run-now', async (req, res) => {
  try {
    const workflow = await memory.getWorkflow(req.params.id);
    // Another workspace's workflow is reported as not found.
    if (!(await visibleOne(workflow, req))) return res.status(404).json({ error: 'Workflow not found' });
    await scheduler.runWorkflow(workflow);
    const updated = await memory.getWorkflow(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
