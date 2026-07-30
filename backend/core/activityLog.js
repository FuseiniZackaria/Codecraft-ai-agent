const { randomUUID } = require('crypto');
const memory = require('../memory');
const bus = require('./eventBus');

/**
 * Records one activity event: persists it (same audit_log used by the
 * Dashboard's Activity feed) AND pushes it live to any connected SSE
 * clients. This never carries raw LLM prompts/completions - callers only
 * ever pass structured metadata (tool name, provider, cost, status), which
 * is what keeps the Activity Panel high-level by construction rather than
 * by filtering after the fact.
 *
 * @param {string} actor - agent role, or 'system'/'orchestrator'/'human'
 * @param {string} action - event type, e.g. 'llm_call', 'tool_call', 'task_started'
 * @param {string} target - tool/provider/agent name involved
 * @param {object} metadata - structured details; may include taskId for grouping
 */
async function record(actor, action, target, metadata = {}) {
  const event = {
    id: randomUUID(),
    actor,
    action,
    target,
    taskId: metadata.taskId || null,
    metadata,
    at: new Date().toISOString(),
  };

  // Persist first (so a page refresh / new SSE client can catch up via
  // /api/events/recent), then broadcast live.
  await memory.audit(actor, action, target, metadata);
  bus.emit('event', event);

  return event;
}

module.exports = { record };
