const crypto = require('crypto');
const config = require('../../config');
const { normalizeNumber, toChatId } = require('./phone');

/**
 * WhatsApp through a self-hosted WAHA server (docker image devlikeapro/waha).
 * One WAHA session = one linked WhatsApp account (one admin).
 *
 * Every call sends the X-Api-Key header and has a timeout. Failures throw a
 * WahaError with a plain-language message; callers catch it - WAHA being down
 * must never crash the backend.
 */
class WahaError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'WahaError';
    this.status = status;
  }
}

const name = 'waha';

function isConfigured() {
  return !!config.waha.baseUrl;
}

async function call(method, path, { body, accept = 'application/json', allow404 = false } = {}) {
  if (!isConfigured()) throw new WahaError('WAHA is not configured - set WAHA_BASE_URL (and WAHA_API_KEY).');
  let res;
  try {
    res = await fetch(`${config.waha.baseUrl}${path}`, {
      method,
      headers: {
        Accept: accept,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(config.waha.apiKey ? { 'X-Api-Key': config.waha.apiKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(config.waha.timeoutMs),
    });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? `no answer within ${config.waha.timeoutMs / 1000}s` : err.cause?.code || err.message;
    throw new WahaError(`Can't reach WAHA at ${config.waha.baseUrl} (${why}). Is the WAHA container running?`);
  }
  if (res.status === 404 && allow404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new WahaError('WAHA rejected the API key - WAHA_API_KEY must match the key the WAHA container was started with.', res.status);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = json?.message || json?.error || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new WahaError(`WAHA ${method} ${path} failed: ${Array.isArray(detail) ? detail.join(', ') : detail}`, res.status);
  }
  return json;
}

function sessionConfig({ webhookUrl, metadata }) {
  const webhooks = webhookUrl
    ? [{
      url: webhookUrl,
      events: ['message', 'session.status'],
      ...(config.waha.webhookSecret ? { hmac: { key: config.waha.webhookSecret } } : {}),
      retries: { policy: 'exponential', delaySeconds: 2, attempts: 5 },
    }]
    : [];
  return { webhooks, metadata: metadata || {} };
}

/**
 * Create the session if it doesn't exist, refresh its webhook config, and
 * start it. Returns the normalized status (see getStatus).
 */
async function startSession(sessionName, { webhookUrl, metadata } = {}) {
  const existing = await call('GET', `/api/sessions/${encodeURIComponent(sessionName)}`, { allow404: true });
  const cfg = sessionConfig({ webhookUrl, metadata });
  if (!existing) {
    await call('POST', '/api/sessions', { body: { name: sessionName, start: true, config: cfg } });
  } else {
    await call('PUT', `/api/sessions/${encodeURIComponent(sessionName)}`, { body: { name: sessionName, config: cfg } });
    if (['STOPPED', 'FAILED'].includes(existing.status)) {
      await call('POST', `/api/sessions/${encodeURIComponent(sessionName)}/start`);
    }
  }
  return getStatus(sessionName);
}

/** QR code to scan, as a data: URL for an <img>, or null when there's none to show. */
async function getQR(sessionName) {
  const json = await call('GET', `/api/${encodeURIComponent(sessionName)}/auth/qr?format=image`, { allow404: true });
  if (!json?.data) return null;
  return `data:${json.mimetype || 'image/png'};base64,${json.data}`;
}

/**
 * { status, phoneNumber, pushName }. status is WAHA's: STOPPED, STARTING,
 * SCAN_QR_CODE, WORKING, FAILED - or NOT_FOUND when the session doesn't exist.
 */
async function getStatus(sessionName) {
  const json = await call('GET', `/api/sessions/${encodeURIComponent(sessionName)}`, { allow404: true });
  if (!json) return { status: 'NOT_FOUND', phoneNumber: null, pushName: null, webhooks: [] };
  return {
    status: json.status || 'UNKNOWN',
    phoneNumber: json.me?.id ? normalizeNumber(json.me.id) : null,
    pushName: json.me?.pushName || null,
    webhooks: (json.config?.webhooks || []).map((w) => w.url).filter(Boolean),
  };
}

async function sendMessage(sessionName, to, text) {
  require('../sendGuard').assertRealSendsAllowed('WhatsApp (WAHA)'); // test runs never send for real
  const json = await call('POST', '/api/sendText', { body: { session: sessionName, chatId: toChatId(to), text } });
  return { id: json?.id?._serialized || json?.id || json?.key?.id || null };
}

/** Show (on=true) or clear "typing..." in the contact's chat. Never throws. */
async function sendTyping(sessionName, to, on = true) {
  try {
    await call('POST', on ? '/api/startTyping' : '/api/stopTyping', { body: { session: sessionName, chatId: toChatId(to) } });
  } catch (err) {
    console.warn(`[waha] typing indicator failed (${sessionName}): ${err.message}`);
  }
}

/** Log out (unlinks the device in WhatsApp) and stop the session. A missing session is fine. */
async function disconnect(sessionName) {
  await call('POST', `/api/sessions/${encodeURIComponent(sessionName)}/logout`, { allow404: true }).catch((err) => {
    console.warn(`[waha] logout failed (${sessionName}): ${err.message}`);
  });
  await call('POST', `/api/sessions/${encodeURIComponent(sessionName)}/stop`, { allow404: true }).catch(() => {});
}

/** True when the HMAC-SHA512 signature WAHA sent matches the raw body. */
function verifySignature(rawBody, signature) {
  if (!config.waha.webhookSecret || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', config.waha.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(signature).trim(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Turn a WAHA webhook request into one of:
 *   { type: 'rejected', reason }
 *   { type: 'message', sessionName, message: { waMessageId, contactNumber, contactName, text, timestamp } }
 *   { type: 'status', sessionName, status, phoneNumber, pushName }
 *   { type: 'ignored', reason }
 * `req.rawBody` must be the exact bytes WAHA sent (see server.js express.json verify).
 */
function handleIncomingWebhook(req) {
  if (!config.waha.webhookSecret) return { type: 'rejected', reason: 'WAHA_WEBHOOK_SECRET is not set, so webhooks cannot be verified' };
  if (!verifySignature(req.rawBody, req.headers['x-webhook-hmac'])) return { type: 'rejected', reason: 'bad or missing X-Webhook-Hmac signature' };

  const { event, session: sessionName, payload = {}, me } = req.body || {};
  if (!sessionName) return { type: 'ignored', reason: 'no session in payload' };

  if (event === 'session.status') {
    return {
      type: 'status',
      sessionName,
      status: payload.status || 'UNKNOWN',
      phoneNumber: me?.id ? normalizeNumber(me.id) : null,
      pushName: me?.pushName || null,
    };
  }

  if (event === 'message') {
    if (payload.fromMe) return { type: 'ignored', reason: 'own message' };
    const from = String(payload.from || '');
    if (!/@(c\.us|s\.whatsapp\.net)$/.test(from)) return { type: 'ignored', reason: `not a one-to-one chat (${from.split('@')[1] || 'unknown'})` };
    const contactNumber = normalizeNumber(from);
    if (!contactNumber) return { type: 'ignored', reason: 'unreadable sender number' };
    const text = payload.body || (payload.hasMedia ? '[media message]' : '');
    return {
      type: 'message',
      sessionName,
      message: {
        waMessageId: payload.id || null,
        contactNumber,
        contactName: payload._data?.notifyName || payload._data?.pushName || payload.notifyName || null,
        text,
        timestamp: payload.timestamp ? new Date(payload.timestamp * 1000).toISOString() : new Date().toISOString(),
      },
    };
  }

  return { type: 'ignored', reason: `event ${event}` };
}

module.exports = {
  name, isConfigured, startSession, getQR, getStatus, sendMessage, sendTyping, disconnect,
  handleIncomingWebhook, verifySignature, WahaError,
};
