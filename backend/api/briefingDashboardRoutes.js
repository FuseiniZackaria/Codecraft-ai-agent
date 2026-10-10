const express = require('express');
const memory = require('../memory');
const { computeDashboardStats } = require('../core/briefing/dashboardStats');

const router = express.Router();

// Political intelligence dashboard - aggregated stats for one specific
// recurring briefing, identified by its exact goal text (same key
// briefing_runs/briefing_articles already use). Split into its own file so
// it can be mounted with a role check that allows BOTH admin and client -
// unlike everything in routes.js (tasks, chat, orchestrator goals), which
// stays admin-only.
router.get('/briefing', async (req, res) => {
  try {
    const goal = req.query.goal;
    if (!goal) return res.status(400).json({ error: '"goal" query parameter is required' });
    const articles = await memory.getBriefingArticles(goal, {
      sinceDays: 14,
      workspaceId: req.user?.workspaceId || null,
    });
    res.json(computeDashboardStats(articles));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;