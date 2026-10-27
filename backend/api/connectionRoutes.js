const express = require('express');
const https = require('https');
const config = require('../config');
const connections = require('../core/workspaceConnections');
const composio = require('../core/composio');

const router = express.Router();

const COMPOSIO_PROVIDERS = new Set(['gmail', 'googlecalendar', 'github']);
const ALL_PROVIDERS = new Set(['gmail', 'googlecalendar', 'github', 'telegram', 'whatsapp']);

// ---------- Composio (Gmail, Calendar, GitHub) helpers ----------
//
// Every workspace has its own Composio entity ("ws_<workspace_id>"). A stored
// row counts as connected only if it belongs to that entity (or, for the app
// owner's workspace only, the server's legacy account). Anything else is a
// stale row - e.g. one the old connect flow "adopted" from another workspace's
// account - and is removed from the database (nothing is revoked at Composio).

function connectionRow(acct, identity) {
  return {
    composio_account_id: acct.id,
    provider_meta: { composio_user_id: acct.userId },
    status: 'connected',
    connected_email: identity || null,
  };
}

async function composioConnection(wsId, provider) {
  const owner = await composio.isOwnerWorkspace(wsId);
  let conn = await connections.getConnection(wsId, provider);
  // The owner disconnected the server's legacy account (e.g. its token expired):
  // show "not connected" so they can sign in again, and never re-attach it.
  if (conn && conn.status !== 'connected' && conn.provider_meta?.legacy_dismissed) return null;
  if (conn && !composio.isVerifiedConnection(wsId, conn, { owner })) {
    console.warn(`[connections] removing unverified ${provider} row for workspace ${wsId} (not owned by its entity)`);
    await connections.deleteConnection(wsId, provider);
    conn = null;
  }
  // The owner's pre-workspace connection is mapped to the owner workspace only,
  // so it keeps working without reconnecting.
  if (!conn && owner && config.composio.apiKey) {
    const legacy = await composio.findLegacyAccount(provider);
    if (legacy) {
      const identity = await composio.fetchAccountIdentity(provider, legacy);
      conn = await connections.upsertConnection(wsId, provider, connectionRow(legacy, identity));
    }
  }
  return conn;
}

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
      if (COMPOSIO_PROVIDERS.has(p)) {
        const conn = await composioConnection(wsId, p);
        result[p] = conn ? connections.safeConnectionView(conn) : { provider: p, status: 'not_connected' };
        continue;
      }
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
    const conn = COMPOSIO_PROVIDERS.has(provider)
      ? await composioConnection(wsId, provider)
      : await connections.getConnection(wsId, provider);
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

// Connect ALWAYS starts a fresh sign-in under this workspace's own entity. It
// never adopts an existing account (that is how a second workspace used to end
// up "connected" to the owner's Gmail instantly).
router.post('/:provider/connect', async (req, res) => {
  const { provider } = req.params;
  try {
    if (!COMPOSIO_PROVIDERS.has(provider)) {
      return res.status(400).json({ error: `Use the provider-specific connect route for ${provider}.` });
    }
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });
    if (!config.composio.apiKey) {
      return res.status(400).json({ error: 'COMPOSIO_API_KEY is not configured on this server.' });
    }

    const { redirectUrl } = req.body || {};
    const callbackUrl = redirectUrl || `${baseUrl()}/api/connections/${provider}/callback`;
    const started = await composio.startWorkspaceConnection(wsId, provider, callbackUrl);
    res.json({ ok: true, redirectUrl: started.redirectUrl, connectionId: started.connectionId });
  } catch (err) {
    res.status(400).json({ error: `Could not start the ${provider} connection: ${err.message}` });
  }
});

// Marks the connection as connected only once an ACTIVE account exists under
// this workspace's own entity. A connectionId from the request is honoured
// only if it is one of those accounts.
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

    const { connectionId } = req.body || {};
    const acct = await composio.findWorkspaceAccount(wsId, provider, connectionId || null);
    if (!acct) return res.json({ ok: false, status: connectionId ? 'pending' : 'not_connected' });

    const identity = await composio.fetchAccountIdentity(provider, acct);
    const row = await connections.upsertConnection(wsId, provider, connectionRow(acct, identity));
    res.json({ ok: true, status: 'connected', connectionId: acct.id, connected_email: row?.connected_email || identity || null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
// Disconnect any provider. Only ever removes THIS workspace's own row; for
// Composio it also revokes the account at Composio, but only when that account
// belongs to this workspace's entity (never the owner's legacy account, never
// another workspace's).
router.delete('/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    if (!ALL_PROVIDERS.has(provider)) return res.status(400).json({ error: `Unknown provider: ${provider}` });
    const wsId = req.user?.workspaceId;
    if (!wsId) return res.status(400).json({ error: 'No workspace resolved.' });

    const conn = await connections.getConnection(wsId, provider);

    // For Telegram, also unregister the webhook
    if (provider === 'telegram' && conn?.provider_meta?.encrypted_token) {
      try {
        const botToken = connections.decrypt(conn.provider_meta.encrypted_token);
        await callTelegram('deleteWebhook', {}, botToken);
      } catch { /* best effort */ }
    }

    let revoked = false;
    if (COMPOSIO_PROVIDERS.has(provider) && config.composio.apiKey) {
      revoked = await composio.revokeWorkspaceAccount(wsId, conn);
    }

    // The owner's legacy (.env) account is never revoked, but it must not be
    // re-attached on the next page load either - remember the disconnect so the
    // card offers "Connect" and the next sign-in replaces it.
    if (COMPOSIO_PROVIDERS.has(provider) && await composio.isOwnerWorkspace(wsId)) {
      await connections.upsertConnection(wsId, provider, {
        composio_account_id: null,
        provider_meta: { legacy_dismissed: true },
        status: 'disconnected',
        connected_email: null,
      });
      return res.json({ ok: true, revoked });
    }

    await connections.deleteConnection(wsId, provider);
    res.json({ ok: true, revoked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
