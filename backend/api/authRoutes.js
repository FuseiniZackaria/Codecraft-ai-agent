const express = require('express');
const googleAuth = require('../core/googleAuth');

const router = express.Router();

// Visit this in a browser to start the Gmail connection flow.
router.get('/google', (req, res) => {
  try {
    res.redirect(googleAuth.getAuthUrl());
  } catch (err) {
    res.status(500).send(`Google OAuth not configured: ${err.message}`);
  }
});p

// Google redirects here after the user grants (or denies) access.
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google denied access: ${error}`);
  if (!code) return res.status(400).send('Missing authorization code');

  try {
    await googleAuth.handleCallback(code);
    res.send(`
      <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h2>✅ Gmail connected</h2>
        <p>You can close this tab and go back to CodeCraft AI.</p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`Failed to connect Gmail: ${err.message}`);
  }
});

router.get('/google/status', async (req, res) => {
  res.json({ connected: await googleAuth.isConnected() });
});

module.exports = router;
