const BaseAgent = require('../base/BaseAgent');
const { selectProvider } = require('../../core/router');
const { businessContextLine } = require('../../core/businessContext');

/**
 * WhatsAppAgent - triggered by the webhook receiver on each incoming
 * customer message, not a user goal, so it skips the standard plan/execute
 * loop. Drafts a reply and spawns it as its own pending_approval task,
 * same safety pattern as every other channel - no unsupervised auto-send.
 */
class WhatsAppAgent extends BaseAgent {
  constructor() {
    super({
      key: 'whatsapp',
      role: 'WhatsApp Agent',
      goals: ['Draft timely, on-brand replies to incoming customer messages for human approval'],
      tools: ['whatsapp.sendMessage'],
    });
  }

  async handleIncomingMessage({ from, body }) {
    const provider = selectProvider({});
    const result = await provider.complete({
      maxTokens: 400,
      system:
        `${businessContextLine()}You are drafting a WhatsApp reply to a customer message, in the ` +
        `business's voice - warm, brief, direct, not robotic. Respond with ONLY the reply text, ` +
        `nothing else - no quotes, no explanation.`,
      prompt: `Customer's message: "${body}"`,
    });

    const draft = result.text.trim();
    await this.createApprovalTask({
      instruction: `Reply on WhatsApp to ${from}`,
      tool: 'whatsapp.sendMessage',
      payload: { to: from, body: draft },
    });

    return draft;
  }
}

module.exports = WhatsAppAgent;
