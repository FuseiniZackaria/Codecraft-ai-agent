const express = require('express');
const analytics = require('../core/analytics');

const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const sinceDays = req.query.sinceDays ? Math.min(Number(req.query.sinceDays), 365) : 30;
    res.json(await analytics.getSummary({ sinceDays }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
