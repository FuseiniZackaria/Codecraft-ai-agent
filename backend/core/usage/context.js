const { AsyncLocalStorage } = require('async_hooks');

/**
 * Who an AI call is for - carried through orchestrator -> agent -> provider
 * without changing any function signatures (Node's AsyncLocalStorage).
 *
 *   - requireAuth starts it for every signed-in request: { userId, email }.
 *   - Background work (scheduler, WhatsApp/Telegram webhooks, the video
 *     worker's planning) runs with no user: the "automated" bucket.
 *   - BaseAgent adds the agent and task, so usage can be broken down by agent.
 */

const store = new AsyncLocalStorage();
const AUTOMATED_ID = 'automated'; // usage_caps / api_usage key for work with no user

function runForUser(user, fn) {
  return store.run({ userId: user?.id || null, email: user?.email || null, role: user?.role || null, automated: !user?.id }, fn);
}

/** Work started by no one (timers, webhooks): never attributed to whoever's request happened to be running. */
function runAutomated(fn) {
  return store.run({ userId: null, email: null, automated: true }, fn);
}

/** Add details (agent, task) for the code inside `fn`, keeping the user. */
function withDetails(details, fn) {
  const cur = store.getStore() || { userId: null, email: null, automated: true };
  return store.run({ ...cur, ...details }, fn);
}

function current() {
  return store.getStore() || { userId: null, email: null, automated: true };
}

module.exports = { runForUser, runAutomated, withDetails, current, AUTOMATED_ID };
