const crypto = require('crypto');
const config = require('../config');
const memory = require('../memory');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

let _key = null;
function getKey() {
  if (_key) return _key;
  const raw = process.env.WORKSPACE_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!raw) throw new Error('No encryption key available (set WORKSPACE_ENCRYPTION_KEY or SUPABASE_SERVICE_KEY)');
  _key = crypto.createHash('sha256').update(raw).digest();
  return _key;
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { iv: iv.toString('hex'), tag, enc };
}

function decrypt({ iv, tag, enc }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function generateWebhookToken() {
  return crypto.randomUUID();
}

async function getConnection(workspaceId, provider) {
  return memory.getWorkspaceConnection(workspaceId, provider);
}

async function listConnections(workspaceId) {
  return memory.listWorkspaceConnections(workspaceId);
}

async function upsertConnection(workspaceId, provider, data) {
  return memory.upsertWorkspaceConnection(workspaceId, provider, data, { workspaceId });
}

async function deleteConnection(workspaceId, provider) {
  return memory.deleteWorkspaceConnection(workspaceId, provider, { workspaceId });
}

async function findByWebhookToken(provider, webhookToken) {
  return memory.findConnectionByWebhookToken(provider, webhookToken);
}

function safeConnectionView(conn) {
  if (!conn) return null;
  const meta = conn.provider_meta || {};
  const safe = {
    provider: conn.provider,
    status: conn.status,
    connected_email: conn.connected_email || null,
    created_at: conn.created_at,
    updated_at: conn.updated_at,
  };
  if (meta.bot_username) safe.bot_username = meta.bot_username;
  if (meta.type) safe.type = meta.type;
  if (meta.display_phone) safe.display_phone = meta.display_phone;
  if (meta.whatsapp_from) safe.whatsapp_from = meta.whatsapp_from;
  if (meta.composio_account_id) safe.composio_account_id = meta.composio_account_id;
  if (meta.webhook_token) {
    const baseUrl = (process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || `http://localhost:${config.port}`).replace(/\/$/, '');
    if (conn.provider === 'telegram') {
      safe.webhook_url = `${baseUrl}/webhooks/telegram/${meta.webhook_token}`;
    } else if (conn.provider === 'whatsapp') {
      if (meta.type === 'twilio') {
        safe.webhook_url = `${baseUrl}/webhooks/whatsapp/twilio/${meta.webhook_token}`;
      } else {
        safe.webhook_url = `${baseUrl}/webhooks/whatsapp/${meta.webhook_token}`;
      }
    }
  }
  if (meta.webhook_verify_token) safe.webhook_verify_token = meta.webhook_verify_token;
  return safe;
}

module.exports = {
  encrypt,
  decrypt,
  generateWebhookToken,
  getConnection,
  listConnections,
  upsertConnection,
  deleteConnection,
  findByWebhookToken,
  safeConnectionView,
};
