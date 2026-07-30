const express = require('express');
const memory = require('../memory');
const bus = require('../core/eventBus');

const router = express.Router();

// Initial page load: fetch recent history to backfill before the live
// stream starts (SSE only pushes NEW events from the moment of connection).
router.get('/recent', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const log = await memory.getAuditLog();
    res.json(log.slice(-limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server-Sent Events stream - one long-lived connection per client, pushed
// to whenever activityLog.record() fires anywhere in the backend.
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering if ever deployed behind it
  });
  res.write(': connected\n\n');

  const onEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  bus.on('event', onEvent);

  // Keep the connection alive through proxies/browsers that time out idle
  // HTTP connections - a comment line, not a real event.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    bus.off('event', onEvent);
  });
});

module.exports = router;
