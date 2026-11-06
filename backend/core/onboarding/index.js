const store = require('./store');

/**
 * Onboarding: the welcome screen, the setup checklist and the guided tour.
 *
 * Whether a checklist step is DONE is worked out from the real data every time
 * (a business name saved, a product added, WhatsApp linked...), so it ticks
 * itself off. Only the person's choices are stored: welcome seen, steps
 * skipped, checklist hidden, tour seen (per person).
 */

const STEPS = [
  { key: 'profile', label: 'Fill in your Business Profile', description: 'Your business name, what you do and how customers reach you.', to: '/settings' },
  { key: 'agent', label: "Set your agent's tone and instructions", description: 'How your assistant talks to customers and what it should never say.', to: '/settings?tab=agent' },
  { key: 'knowledge', label: 'Add your knowledge base', description: 'Common questions and answers, or upload price lists and FAQs.', to: '/settings?tab=qa' },
  { key: 'products', label: 'Add or import your products', description: 'Import from your website, upload a list, or add them one by one.', to: '/settings?tab=products' },
  { key: 'whatsapp', label: 'Connect WhatsApp', description: 'Link your number with a QR code or a pairing code.', to: '/toolbox/connections' },
  { key: 'test', label: 'Test your agent in the Test chat', description: 'Chat with your assistant as a customer would - nothing is sent to anyone.', to: '/settings?tab=test' },
];
const KEYS = STEPS.map((s) => s.key);

const safe = (p) => Promise.resolve().then(p).catch(() => false);

/** Which steps are done, from the workspace's real data. A check that fails counts as not done. */
async function doneSteps(workspaceId) {
  const kb = require('../knowledge/store');
  const [profile, agent, knowledge, products, whatsapp, test] = await Promise.all([
    safe(async () => {
      const p = await require('../businessProfile').getProfile(workspaceId);
      return !!(p && String(p.business_name || '').trim());
    }),
    safe(async () => !!(await kb.getLatestVersion(workspaceId))),
    safe(async () => (await kb.countQa(workspaceId)) > 0 || (await kb.listDocuments(workspaceId)).length > 0),
    safe(async () => (await require('../catalog/store').countProducts(workspaceId, { activeOnly: false })) > 0),
    safe(async () => (await require('../whatsapp/store').listWorkingSessions(workspaceId)).length > 0),
    safe(async () => (await kb.listTestMessages(workspaceId, 1)).length > 0),
  ]);
  return { profile, agent, knowledge, products, whatsapp, test };
}

/** Everything the app needs to show the welcome screen, checklist and tour for this person. */
async function status(workspaceId, user) {
  const [done, canConnect] = await Promise.all([
    doneSteps(workspaceId),
    require('../whatsapp').canConnectWhatsapp(user).catch(() => true),
  ]);
  let saved;
  let migrationMissing = false;
  try {
    saved = await store.get(workspaceId);
  } catch (err) {
    if (err.code !== 'MIGRATION_MISSING') throw err;
    migrationMissing = true;
    saved = null;
  }
  const skipped = new Set(saved?.skipped || []);
  const steps = STEPS.map((s) => {
    // One WhatsApp number for now: for everyone else this step is "not available yet", not a to-do.
    const unavailable = s.key === 'whatsapp' && !done.whatsapp && !canConnect;
    return { ...s, done: !!done[s.key], skipped: !done[s.key] && skipped.has(s.key), unavailable };
  });
  const counted = steps.filter((s) => !s.unavailable);
  const doneCount = counted.filter((s) => s.done).length;
  const complete = counted.every((s) => s.done || s.skipped);
  return {
    steps,
    doneCount,
    total: counted.length,
    complete,
    allDone: doneCount === counted.length,
    // Until migration 0009 is run nothing pops up (it couldn't be remembered), but the checklist still works.
    showWelcome: !migrationMissing && !saved.welcome_seen_at,
    showTour: !migrationMissing && !!user?.id && !(saved.tour_seen_by || []).includes(user.id),
    checklistHidden: !!saved?.checklist_hidden && complete,
    migrationMissing,
  };
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID', details: [message] });
}

async function markWelcomeSeen(workspaceId) {
  const s = await store.get(workspaceId);
  if (!s.welcome_seen_at) await store.save(workspaceId, { welcome_seen_at: new Date().toISOString() });
}

async function setSkipped(workspaceId, step, skip = true) {
  if (!KEYS.includes(step)) throw invalid(`Unknown step "${step}".`);
  const s = await store.get(workspaceId);
  const set = new Set(s.skipped || []);
  if (skip) set.add(step); else set.delete(step);
  await store.save(workspaceId, { skipped: [...set] });
}

async function setHidden(workspaceId, hidden = true) {
  await store.save(workspaceId, { checklist_hidden: !!hidden });
}

async function markTourSeen(workspaceId, userId) {
  if (!userId) return;
  const s = await store.get(workspaceId);
  if (!(s.tour_seen_by || []).includes(userId)) await store.save(workspaceId, { tour_seen_by: [...(s.tour_seen_by || []), userId] });
}

module.exports = { status, doneSteps, markWelcomeSeen, setSkipped, setHidden, markTourSeen, STEPS };
