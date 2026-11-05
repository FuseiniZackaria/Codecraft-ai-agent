const crypto = require('crypto');
const config = require('../../config');
const { normalizeNumber, toChatId } = require('./phone');

/**
 * WhatsApp through WAHA (image devlikeapro/waha), deployed as its own Render web service.
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

// Header the session webhook carries so the backend can tell which key it was
// registered with. The value is a short fingerprint (first 12 hex of SHA-256)
// of WAHA_WEBHOOK_SECRET - enough to spot "registered with an old secret",
// useless for recovering the secret itself.
const FINGERPRINT_HEADER = 'X-CodeCraft-Webhook-Key';

function secretFingerprint(secret = config.waha.webhookSecret) {
  return secret ? crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12) : null;
}

function sessionConfig({ webhookUrl, metadata }) {
  const fp = secretFingerprint();
  const webhooks = webhookUrl
    ? [{
      url: webhookUrl,
      events: ['message', 'session.status'],
      ...(config.waha.webhookSecret ? { hmac: { key: config.waha.webhookSecret } } : {}),
      ...(fp ? { customHeaders: [{ name: FINGERPRINT_HEADER, value: fp }] } : {}),
      // A sleeping free-plan backend takes ~30-60s to wake: keep retrying for ~2 minutes.
      // Retries are safe - the backend drops messages it has already seen.
      retries: { policy: 'constant', delaySeconds: 10, attempts: 12 },
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
    // Updating the config can leave the session stopped - make sure it runs again
    // (the WhatsApp login is kept on WAHA's disk, so no new QR scan is needed).
    const after = await call('GET', `/api/sessions/${encodeURIComponent(sessionName)}`, { allow404: true });
    if (['STOPPED', 'FAILED'].includes(after?.status || existing.status)) {
      await call('POST', `/api/sessions/${encodeURIComponent(sessionName)}/start`);
    }
  }
  return getStatus(sessionName);
}

/**
 * Session webhooks pointing at `url` that would be rejected with the CURRENT
 * WAHA_WEBHOOK_SECRET: no signature key, a key that differs (when WAHA shows
 * it), or a fingerprint header from an older secret (or none at all).
 */
function staleWebhooks(webhooks, url) {
  const fp = secretFingerprint();
  if (!fp) return [];
  return webhooks.filter((w) => w.url === url).filter((w) => {
    if (!w.hmac?.key) return true;
    if (typeof w.hmac.key === 'string' && !w.hmac.key.includes('*') && w.hmac.key !== config.waha.webhookSecret) return true;
    const header = (w.customHeaders || []).find((h) => String(h.name).toLowerCase() === FINGERPRINT_HEADER.toLowerCase());
    return !header || header.value !== fp;
  }).map((w) => w.url);
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
  if (!json) return { status: 'NOT_FOUND', phoneNumber: null, pushName: null, webhooks: [], rawWebhooks: [] };
  const hooks = (json.config?.webhooks || []).filter((w) => w?.url);
  return {
    status: json.status || 'UNKNOWN',
    phoneNumber: json.me?.id ? normalizeNumber(json.me.id) : null,
    pushName: json.me?.pushName || null,
    webhooks: hooks.map((w) => w.url),
    // Webhooks registered WITHOUT a signature key (e.g. connected before WAHA_WEBHOOK_SECRET was set).
    unsignedWebhooks: hooks.filter((w) => !w.hmac?.key).map((w) => w.url),
    rawWebhooks: hooks,
  };
}

/**
 * WhatsApp increasingly names senders by a private "linked id" (123...@lid)
 * instead of their phone number. Ask WAHA for the phone number behind it.
 * Returns digits (e.g. "233241234567") or null when WhatsApp doesn't share it.
 */
async function resolveLid(sessionName, lid) {
  const json = await call('GET', `/api/${encodeURIComponent(sessionName)}/lids/${encodeURIComponent(lid)}`, { allow404: true });
  return json?.pn ? normalizeNumber(json.pn) : null;
}

/**
 * Phone number of the sender, read from WAHA's extra fields when `from` is an
 * @lid (engines include it under different names, e.g. SenderAlt /
 * remoteJidAlt). Never returns our own number or the recipient's.
 */
function phoneFromPayload(payload, me) {
  const exclude = new Set([normalizeNumber(me?.id || ''), normalizeNumber(payload.to || '')].filter(Boolean));
  const json = JSON.stringify({ alt: payload._data || {}, participant: payload.participant || null });
  for (const m of json.matchAll(/"(\d{8,15})@(?:c\.us|s\.whatsapp\.net)"/g)) {
    const digits = normalizeNumber(`${m[1]}@c.us`);
    if (digits && !exclude.has(digits)) return digits;
  }
  return null;
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

const SUPPORTED_ALGORITHMS = new Set(['sha512', 'sha256']);

/**
 * True when the HMAC WAHA sent (hex, in X-Webhook-Hmac) matches the raw body.
 * WAHA uses sha512 (X-Webhook-Hmac-Algorithm); sha256 is accepted too.
 */
function verifySignature(rawBody, signature, algorithm = 'sha512') {
  const algo = String(algorithm || 'sha512').toLowerCase();
  if (!config.waha.webhookSecret || !rawBody || !signature || !SUPPORTED_ALGORITHMS.has(algo)) return false;
  const expected = crypto.createHmac(algo, config.waha.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(signature).trim().toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Safe summary of a webhook's signature check for the logs - never the secret
 * or the signature itself. `source` tells a session webhook registered with
 * the current secret from one registered with an older secret (or the
 * WHATSAPP_HOOK_* env webhook, which doesn't carry the fingerprint header).
 */
function inspectSignature(req) {
  const secret = config.waha.webhookSecret || '';
  const signature = req.headers['x-webhook-hmac'];
  const algorithm = req.headers['x-webhook-hmac-algorithm'] || null;
  const fpHeader = req.headers[FINGERPRINT_HEADER.toLowerCase()];
  const fp = secretFingerprint();
  let source = 'env webhook (WHATSAPP_HOOK_*) or a session webhook from before this check existed';
  if (fpHeader) source = fpHeader === fp ? 'session webhook (current secret)' : 'session webhook registered with an OLD secret';
  return {
    hmacHeaderPresent: !!signature,
    signatureLength: signature ? String(signature).trim().length : 0, // sha512 hex = 128
    algorithm: algorithm || '(header missing - assuming sha512)',
    rawBodyUsed: Buffer.isBuffer(req.rawBody),
    rawBodyBytes: Buffer.isBuffer(req.rawBody) ? req.rawBody.length : 0,
    contentType: req.headers['content-type'] || null,
    source,
    secretSet: !!secret,
    secretLength: secret.length,
    secretHasSurroundingSpaces: secret !== secret.trim(),
    match: verifySignature(req.rawBody, signature, algorithm || 'sha512'),
  };
}

/**
 * Turn a WAHA webhook request into one of:
 *   { type: 'rejected', reason }
 *   { type: 'message', sessionName, message: { waMessageId, contactNumber, contactName, text, timestamp } }
 *   { type: 'status', sessionName, status, phoneNumber, pushName }
 *   { type: 'ignored', reason }
 * `req.rawBody` must be the exact bytes WAHA sent (see server.js express.json verify).
 */
const MEDIA_LABELS = {
  voice: '[voice note]', image: '[image]', sticker: '[sticker]', video: '[video]', file: '[file]',
};

/**
 * 'voice' | 'image' | 'sticker' | 'video' | 'file', or null for a text message.
 * WAHA engines describe media differently (WEBJS: _data.type; GOWS: _data.Message.*Message
 * or _data.Info.MediaType; all: media.mimetype), so each is checked.
 */
function mediaKind(payload = {}) {
  const data = payload._data || {};
  const inner = data.Message || data.message || {};
  const type = String(payload.type || data.type || data.Info?.MediaType || data.Info?.Type || '').toLowerCase();
  const mime = String(payload.media?.mimetype || payload.mimetype || data.mimetype || '').toLowerCase();
  if (type === 'ptt' || type === 'audio' || inner.audioMessage || inner.pttMessage || mime.startsWith('audio/')) return 'voice';
  if (type === 'sticker' || inner.stickerMessage) return 'sticker';
  if (type === 'image' || inner.imageMessage) return 'image';
  if (type === 'video' || type === 'gif' || inner.videoMessage) return 'video';
  if (type === 'document' || inner.documentMessage) return 'file';
  if (mime === 'image/webp') return 'sticker';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (payload.hasMedia || mime) return 'file';
  return null;
}

function handleIncomingWebhook(req) {
  if (!config.waha.webhookSecret) return { type: 'rejected', reason: 'WAHA_WEBHOOK_SECRET is not set, so webhooks cannot be verified' };
  if (!verifySignature(req.rawBody, req.headers['x-webhook-hmac'], req.headers['x-webhook-hmac-algorithm'] || 'sha512')) {
    return { type: 'rejected', reason: 'bad or missing X-Webhook-Hmac signature' };
  }

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
    const isLid = /@lid$/.test(from);
    if (!isLid && !/@(c\.us|s\.whatsapp\.net)$/.test(from)) {
      return { type: 'ignored', reason: `not a one-to-one chat (${from.split('@')[1] || 'unknown'})` };
    }
    // @lid sender: use the phone number if WAHA included it; otherwise the webhook
    // route looks it up (resolveLid) before the message is handled.
    const contactNumber = isLid ? phoneFromPayload(payload, me) : normalizeNumber(from);
    if (!isLid && !contactNumber) return { type: 'ignored', reason: 'unreadable sender number' };
    const mediaType = mediaKind(payload);
    // A caption counts as the message; a voice note / image / sticker on its own is shown as a label.
    const text = payload.body || (mediaType ? MEDIA_LABELS[mediaType] : '');
    return {
      type: 'message',
      sessionName,
      message: {
        waMessageId: payload.id || null,
        lid: isLid ? from : null,
        contactNumber,
        contactName: payload._data?.notifyName || payload._data?.pushName || payload.notifyName || null,
        text,
        mediaType,
        timestamp: payload.timestamp ? new Date(payload.timestamp * 1000).toISOString() : new Date().toISOString(),
      },
    };
  }

  return { type: 'ignored', reason: `event ${event}` };
}

module.exports = {
  name, isConfigured, startSession, getQR, getStatus, sendMessage, sendTyping, disconnect,
  handleIncomingWebhook, verifySignature, inspectSignature, staleWebhooks, secretFingerprint, resolveLid, mediaKind,
  FINGERPRINT_HEADER, WahaError,
};
