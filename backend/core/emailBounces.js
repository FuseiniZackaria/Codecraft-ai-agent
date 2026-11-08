const memory = require('../memory');

/**
 * Bounced outreach emails ("Address not found").
 *
 * Every 30 minutes, for each workspace that sent outreach email in the last
 * 2 weeks: read Gmail's delivery-failure notices (from mailer-daemon /
 * postmaster, last 3 days), pull out the address that failed, and - only if
 * it's one we sent outreach to - mark it "bounced". A bounced address is never
 * emailed again (gmail.sendEmail refuses it) and you get one alert per address
 * suggesting WhatsApp or a call instead. Read-only on Gmail; never throws.
 */

const CHECK_EVERY_MS = 30 * 60 * 1000;
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
const QUERY = 'from:(mailer-daemon OR postmaster) newer_than:3d';

function unwrap(d, key) {
  for (const c of [d, d?.data, d?.response_data, d?.data?.response_data, d?.response_data?.data]) {
    if (c && typeof c === 'object' && key in c) return c;
  }
  return d || {};
}

function bodyOf(m) {
  if (m.messageText) return m.messageText;
  if (m.preview?.body) return m.preview.body;
  const decode = (data) => Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const walk = (part) => {
    if (!part) return '';
    if (part.body?.data && /text\/plain/.test(part.mimeType || '')) return decode(part.body.data);
    for (const p of part.parts || []) { const t = walk(p); if (t) return t; }
    return '';
  };
  return walk(m.payload) || m.snippet || '';
}

const BOUNCE_WORDS = /address not found|couldn'?t be found|could not be found|does not exist|doesn'?t exist|user unknown|no such user|mailbox (unavailable|not found)|recipient (address )?rejected|undeliverable|wasn'?t delivered|delivery (status notification|has failed)|failed permanently|550[ -]5\.1\.1/i;

/** The addresses a delivery-failure notice says failed. */
function failedAddresses(message) {
  const text = `${message.subject || ''}\n${bodyOf(message)}`;
  if (!BOUNCE_WORDS.test(text)) return [];
  const found = new Set();
  const header = text.match(/X-Failed-Recipients:\s*([^\n]+)/i);
  for (const src of [header?.[1] || '', text]) {
    for (const m of src.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
      const e = m[0].toLowerCase().replace(/[.,;:]+$/, '');
      if (!/^(mailer-daemon|postmaster|noreply|no-reply)@/.test(e)) found.add(e);
    }
  }
  return [...found];
}

/** Has this address bounced before (in this workspace)? */
async function hasBounced(email, workspaceId = null) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || typeof memory.listOutreachThreadsByRecipient !== 'function') return false;
  const rows = await memory.listOutreachThreadsByRecipient(e).catch(() => []);
  return rows.some((r) => r.outreachStatus === 'bounced' && (!workspaceId || !r.workspace_id || r.workspace_id === workspaceId));
}

/** Check one workspace's Gmail for bounces of its outreach. Returns the addresses newly marked. */
async function checkWorkspace(workspaceId, threads) {
  const composio = require('./composio');
  const res = await composio.execute('GMAIL_FETCH_EMAILS', { query: QUERY, max_results: 25 }, 'gmail', { workspaceId });
  const messages = unwrap(res, 'messages').messages || [];
  const bySent = new Map();
  for (const t of threads) if (t.recipientEmail) bySent.set(t.recipientEmail.toLowerCase(), [...(bySent.get(t.recipientEmail.toLowerCase()) || []), t]);

  const marked = [];
  for (const m of messages) {
    for (const email of failedAddresses(m)) {
      const rows = bySent.get(email);
      if (!rows || rows.every((r) => r.outreachStatus === 'bounced')) continue; // not ours, or already handled
      for (const r of rows) {
        if (r.outreachStatus === 'bounced') continue;
        await memory.updateOutreachThread(r.id, {
          outreachStatus: 'bounced',
          metadata: { ...(r.metadata || {}), bouncedAt: new Date().toISOString(), bounceSubject: String(m.subject || '').slice(0, 200) },
        }).catch((err) => console.warn(`[emailBounces] couldn't mark ${email}: ${err.message}`));
        r.outreachStatus = 'bounced';
      }
      marked.push({ email, company: rows[0].companyName || null });
    }
  }

  if (marked.length) {
    const lines = marked.map((b) => `- ${b.email}${b.company ? ` (${b.company})` : ''}`).join('\n');
    const text = `${marked.length === 1 ? 'An outreach email' : `${marked.length} outreach emails`} bounced - the address doesn't exist:\n${lines}\n\n`
      + "CodeCraft won't email " + (marked.length === 1 ? 'it' : 'them') + ' again. If you still want to reach '
      + (marked.length === 1 ? 'them' : 'these businesses') + ', try WhatsApp, a call, or their social media.';
    await require('./notifications').notifyOwner({ subject: 'Outreach email bounced', text, workspaceId })
      .catch((err) => console.warn(`[emailBounces] alert failed: ${err.message}`));
    console.log(`[emailBounces] ${workspaceId}: marked ${marked.length} bounced address(es)`);
  }
  return marked;
}

let lastRun = 0;
let running = false;
/** Scheduler hook (called every minute; does real work every 30 minutes). */
async function tick(now = Date.now()) {
  if (running || now - lastRun < CHECK_EVERY_MS) return;
  running = true;
  lastRun = now;
  try {
    if (typeof memory.listOutreachThreads !== 'function') return;
    const threads = (await memory.listOutreachThreads().catch(() => []))
      .filter((t) => t.outreachStatus !== 'draft' && now - new Date(t.updatedAt || t.createdAt || 0).getTime() < RECENT_MS);
    const byWs = new Map();
    for (const t of threads) {
      const ws = t.workspace_id || t.workspaceId || null;
      if (ws) byWs.set(ws, [...(byWs.get(ws) || []), t]);
    }
    for (const [ws, list] of byWs) {
      await checkWorkspace(ws, list).catch((err) => {
        if (!/not connected|no connected account|COMPOSIO_API_KEY/i.test(err.message)) console.warn(`[emailBounces] ${ws}: ${err.message}`);
      });
    }
  } finally {
    running = false;
  }
}

module.exports = { tick, checkWorkspace, failedAddresses, hasBounced, _reset: () => { lastRun = 0; running = false; } };
