const express = require('express');
const { v4: uuid } = require('uuid');
const memory = require('../memory');
const scheduler = require('../core/scheduler');

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
    res.json(await memory.listWorkflows());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const validationError = validateWorkflowInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const workflow = {
      id: uuid(),
      name: req.body.name,
      goal: req.body.goal,
      scheduleType: req.body.scheduleType,
      intervalMinutes: req.body.scheduleType === 'interval' ? Number(req.body.intervalMinutes) : null,
      dailyTime: req.body.scheduleType === 'daily' ? req.body.dailyTime : null,
      daysOfWeek: req.body.scheduleType === 'daily' ? req.body.daysOfWeek || null : null,
      enabled: req.body.enabled !== false,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
    };
    await memory.saveWorkflow(workflow);
    res.status(201).json(workflow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await memory.getWorkflow(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Workflow not found' });

    const patch = {};
    for (const field of ['name', 'goal', 'scheduleType', 'intervalMinutes', 'dailyTime', 'daysOfWeek', 'enabled']) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }
    const updated = await memory.updateWorkflow(req.params.id, patch);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await memory.deleteWorkflow(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a workflow right now, outside its normal schedule - useful for testing a workflow works before trusting it to run unattended.
router.post('/:id/run-now', async (req, res) => {
  try {
    const workflow = await memory.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    await scheduler.runWorkflow(workflow);
    const updated = await memory.getWorkflow(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
