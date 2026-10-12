const express = require('express');
const https = require('https');
const config = require('../config');
const connections = require('../core/workspaceConnections');

const router = express.Router();

const COMPOSIO_PROVIDERS = new Set(['gmail', 'googlecalendar', 'github']);
const ALL_PROVIDERS = new Set(['gmail', 'googlecalendar', 'github', 'telegram', 'whatsapp']);

// ---------- helpers ----------

function callTelegram(method, body, botToken) {
  return new Promise((resolve, reject) => {
    if (!botToken) return reject(new Error('No bot token'));
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) return reject(new Error(parsed.description || 'Telegram API error'));
            resolve(parsed.result);
          } catch (err) {
            reject(new Error(`Unparseable Telegram response: ${err.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function baseUrl() {
  return (process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || `http://localhost:${config.port}`).replace(/\/$/, '');
}

// ---------- list all connections ----------

router.get('/', async (req, res) => {
  try {
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved for your account.' });
    const rows = await connections.listConnections(wsId);
    const result = {};
    for (const p of ALL_PROVIDERS) {
      const match = rows.find((r) => r.provider === p);
      result[p] = match ? connections.safeConnectionView(match) : { provider: p, status: 'not_connected' };
    }
    res.json({ connections: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- single provider status ----------

router.get('/:provider/status', async (req, res) => {
  try {
    const { provider } = req.params;
    if (!ALL_PROVIDERS.has(provider)) return res.status(400).json({ error: `Unknown provider: ${provider}` });
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });
    const conn = await connections.getConnection(wsId, provider);
    res.json(conn ? connections.safeConnectionView(conn) : { provider, status: 'not_connected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================= TELEGRAM =========================

router.post('/telegram/connect', async (req, res) => {
  try {
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });
    const { botToken } = req.body;
    if (!botToken || typeof botToken !== 'string' || !botToken.includes(':')) {
      return res.status(400).json({ error: 'Invalid bot token. It should look like 123456:ABC-DEF...' });
    }

    const bot = await callTelegram('getMe', {}, botToken);
    const webhookToken = connections.generateWebhookToken();
    const webhookSecret = require('crypto').randomBytes(32).toString('hex');
    const webhookUrl = `${baseUrl()}/webhooks/telegram/${webhookToken}`;

    await callTelegram('setWebhook', {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message'],
    }, botToken);

    const encryptedToken = connections.encrypt(botToken);

    await connections.upsertConnection(wsId, 'telegram', {
      provider_meta: {
        encrypted_token: encryptedToken,
        webhook_token: webhookToken,
        webhook_secret: webhookSecret,
        bot_username: bot.username,
        bot_id: String(bot.id),
      },
      status: 'connected',
    });

    res.json({
      ok: true,
      botUsername: bot.username,
      webhookUrl,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/telegram/test', async (req, res) => {
  try {
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });
    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ error: 'chatId is required. Send /start to your bot first, then paste the chat ID.' });

    const conn = await connections.getConnection(wsId, 'telegram');
    if (!conn || conn.status !== 'connected') {
      return res.status(400).json({ error: 'Telegram is not connected. Connect a bot first.' });
    }

    const botToken = connections.decrypt(conn.provider_meta.encrypted_token);
    require('../core/sendGuard').assertRealSendsAllowed('Telegram');
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `Test message from CodeCraft. Your bot @${conn.provider_meta.bot_username} is working.`,
    }, botToken);

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/telegram', async (req, res) => {
  try {
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });
    const conn = await connections.getConnection(wsId, 'telegram');
    if (conn?.provider_meta?.encrypted_token) {
      try {
        const botToken = connections.decrypt(conn.provider_meta.encrypted_token);
        await callTelegram('deleteWebhook', {}, botToken);
      } catch { /* best effort */ }
    }
    await connections.deleteConnection(wsId, 'telegram');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================= WHATSAPP =========================

router.post('/whatsapp/connect', async (req, res) => {
  try {
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });
    const { provider: whatsappType } = req.body;

    if (whatsappType === 'meta') {
      const { phoneNumberId, accessToken } = req.body;
      if (!phoneNumberId || !accessToken) {
        return res.status(400).json({ error: 'phoneNumberId and accessToken are required.' });
      }
      // Verify credentials
      const verifyRes = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}));
        return res.status(400).json({ error: `Meta verification failed: ${err?.error?.message || verifyRes.status}` });
      }
      const phoneInfo = await verifyRes.json();

      const webhookToken = connections.generateWebhookToken();
      const webhookVerifyToken = require('crypto').randomBytes(16).toString('hex');

      await connections.upsertConnection(wsId, 'whatsapp', {
        provider_meta: {
          type: 'meta',
          phone_number_id: phoneNumberId,
          encrypted_access_token: connections.encrypt(accessToken),
          webhook_token: webhookToken,
          webhook_verify_token: webhookVerifyToken,
          display_phone: phoneInfo.display_phone_number || phoneNumberId,
          verified_name: phoneInfo.verified_name || null,
        },
        status: 'connected',
      });

      res.json({
        ok: true,
        displayPhone: phoneInfo.display_phone_number || phoneNumberId,
        webhookUrl: `${baseUrl()}/webhooks/whatsapp/${webhookToken}`,
        webhookVerifyToken,
      });
    } else if (whatsappType === 'twilio') {
      const { accountSid, authToken, whatsappFrom } = req.body;
      if (!accountSid || !authToken) {
        return res.status(400).json({ error: 'accountSid and authToken are required.' });
      }
      const from = whatsappFrom || 'whatsapp:+14155238886';
      // Verify credentials
      const encoded = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const verifyRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
        headers: { Authorization: `Basic ${encoded}` },
      });
      if (!verifyRes.ok) {
        return res.status(400).json({ error: `Twilio verification failed (HTTP ${verifyRes.status}). Check your Account SID and Auth Token.` });
      }

      const webhookToken = connections.generateWebhookToken();

      await connections.upsertConnection(wsId, 'whatsapp', {
        provider_meta: {
          type: 'twilio',
          account_sid: accountSid,
          encrypted_auth_token: connections.encrypt(authToken),
          whatsapp_from: from,
          webhook_token: webhookToken,
        },
        status: 'connected',
      });

      res.json({
        ok: true,
        whatsappFrom: from,
        webhookUrl: `${baseUrl()}/webhooks/whatsapp/twilio/${webhookToken}`,
      });
    } else {
      res.status(400).json({ error: 'provider must be "meta" or "twilio".' });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/whatsapp/test', async (req, res) => {
  try {
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: '"to" (your WhatsApp number) is required.' });

    const conn = await connections.getConnection(wsId, 'whatsapp');
    if (!conn || conn.status !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp is not connected.' });
    }

    require('../core/sendGuard').assertRealSendsAllowed('WhatsApp');
    const meta = conn.provider_meta;

    if (meta.type === 'meta') {
      const accessToken = connections.decrypt(meta.encrypted_access_token);
      const sendRes = await fetch(`https://graph.facebook.com/v21.0/${meta.phone_number_id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace(/[^0-9]/g, ''),
          type: 'text',
          text: { body: 'Test message from CodeCraft. Your WhatsApp connection is working.' },
        }),
      });
      if (!sendRes.ok) {
        const err = await sendRes.json().catch(() => ({}));
        return res.status(400).json({ error: `Send failed: ${err?.error?.message || sendRes.status}` });
      }
    } else if (meta.type === 'twilio') {
      const authToken = connections.decrypt(meta.encrypted_auth_token);
      const toAddr = to.startsWith('whatsapp:') ? to : `whatsapp:+${to.replace(/[^0-9]/g, '')}`;
      const encoded = Buffer.from(`${meta.account_sid}:${authToken}`).toString('base64');
      const params = new URLSearchParams({
        Body: 'Test message from CodeCraft. Your WhatsApp (Twilio) connection is working.',
        From: meta.whatsapp_from,
        To: toAddr,
      });
      const sendRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${meta.account_sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      if (!sendRes.ok) {
        const err = await sendRes.json().catch(() => ({}));
        return res.status(400).json({ error: `Twilio send failed: ${err?.message || sendRes.status}` });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/whatsapp', async (req, res) => {
  try {
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });
    await connections.deleteConnection(wsId, 'whatsapp');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================= COMPOSIO (Gmail, Calendar, GitHub) =========================

router.post('/:provider/connect', async (req, res) => {
  try {
    const { provider } = req.params;
    if (!COMPOSIO_PROVIDERS.has(provider)) {
      return res.status(400).json({ error: `Use the provider-specific connect route for ${provider}.` });
    }
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });

    if (!config.composio.apiKey) {
      return res.status(400).json({ error: 'COMPOSIO_API_KEY is not configured on this server.' });
    }

    const { redirectUrl } = req.body;
    const callbackUrl = redirectUrl || `${baseUrl()}/api/connections/${provider}/callback`;

    // Initiate connection via Composio REST API
    const initRes = await fetch('https://backend.composio.dev/api/v3/connected_accounts', {
      method: 'POST',
      headers: {
        'x-api-key': config.composio.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolkit_slug: provider,
        entity_id: wsId,
        redirect_url: callbackUrl,
      }),
    });

    if (initRes.ok) {
      const initData = await initRes.json();
      res.json({
        ok: true,
        redirectUrl: initData.redirectUrl || initData.redirect_url || null,
        connectionId: initData.id || initData.connectedAccountId || null,
      });
      return;
    }

    // Fallback: check if there's already a connection we can adopt
    const checkRes = await fetch(`https://backend.composio.dev/api/v3/connected_accounts?toolkit_slug=${provider}`, {
      headers: { 'x-api-key': config.composio.apiKey },
    });
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      const active = (checkData.items || []).filter(
        (a) => a.status === 'ACTIVE' && a.toolkit?.slug?.toLowerCase() === provider.toLowerCase()
      );
      if (active.length > 0) {
        const acct = active[0];
        await connections.upsertConnection(wsId, provider, {
          composio_account_id: acct.id,
          status: 'connected',
          connected_email: acct.metadata?.email || null,
        });
        return res.json({ ok: true, adopted: true, connectionId: acct.id });
      }
    }

    res.status(400).json({
      error: 'Could not initiate Composio connection. Connect the service in the Composio dashboard and then click "Check Connection".',
      dashboardUrl: 'https://app.composio.dev',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:provider/check', async (req, res) => {
  try {
    const { provider } = req.params;
    if (!COMPOSIO_PROVIDERS.has(provider)) {
      return res.status(400).json({ error: `Unknown Composio provider: ${provider}` });
    }
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });

    if (!config.composio.apiKey) {
      return res.status(400).json({ error: 'COMPOSIO_API_KEY not configured.' });
    }

    const { connectionId } = req.body;

    // If a specific connectionId was given (from the initiation flow), check it
    if (connectionId) {
      const detailRes = await fetch(`https://backend.composio.dev/api/v3/connected_accounts/${connectionId}`, {
        headers: { 'x-api-key': config.composio.apiKey },
      });
      if (detailRes.ok) {
        const detail = await detailRes.json();
        if (detail.status === 'ACTIVE') {
          await connections.upsertConnection(wsId, provider, {
            composio_account_id: connectionId,
            status: 'connected',
            connected_email: detail.metadata?.email || null,
          });
          return res.json({ ok: true, status: 'connected', connectionId });
        }
        return res.json({ ok: false, status: detail.status || 'pending' });
      }
    }

    // Fall back to scanning all connections for this toolkit
    const checkRes = await fetch(`https://backend.composio.dev/api/v3/connected_accounts?toolkit_slug=${provider}`, {
      headers: { 'x-api-key': config.composio.apiKey },
    });
    if (!checkRes.ok) {
      return res.status(400).json({ error: 'Could not query Composio.' });
    }
    const checkData = await checkRes.json();
    const active = (checkData.items || []).filter(
      (a) => a.status === 'ACTIVE' && a.toolkit?.slug?.toLowerCase() === provider.toLowerCase()
    );
    if (active.length > 0) {
      const acct = active[0];
      await connections.upsertConnection(wsId, provider, {
        composio_account_id: acct.id,
        status: 'connected',
        connected_email: acct.metadata?.email || null,
      });
      return res.json({ ok: true, status: 'connected', connectionId: acct.id });
    }

    res.json({ ok: false, status: 'not_connected' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Disconnect any provider
router.delete('/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    if (!ALL_PROVIDERS.has(provider)) return res.status(400).json({ error: `Unknown provider: ${provider}` });
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });

    // For Telegram, also unregister the webhook
    if (provider === 'telegram') {
      const conn = await connections.getConnection(wsId, 'telegram');
      if (conn?.provider_meta?.encrypted_token) {
        try {
          const botToken = connections.decrypt(conn.provider_meta.encrypted_token);
          await callTelegram('deleteWebhook', {}, botToken);
        } catch { /* best effort */ }
      }
    }

    await connections.deleteConnection(wsId, provider);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
