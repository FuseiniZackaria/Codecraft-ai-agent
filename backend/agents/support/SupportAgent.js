const BaseAgent = require('../base/BaseAgent');
const memory = require('../../memory');

function extractEmail(text) {
  const match = (text || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

/**
 * SupportAgent - handles a specific, named support request ("respond to
 * this customer question: ...") as opposed to PersonalAssistantAgent, which
 * autonomously triages the whole inbox. Drafts one reply, spawns it as its
 * own approval-gated email task - same safety pattern as every other channel.
 */
class SupportAgent extends BaseAgent {
  constructor() {
    super({
      key: 'support',
      role: 'Customer Support Agent',
      goals: ['Resolve customer questions and issues clearly and quickly'],
      tools: ['gmail.sendEmail'],
    });
  }

  async plan(task) {
    return [
      {
        type: 'llm_call',
        maxTokens: 1024,
        instruction:
          `A customer said: "${task.instruction}"\n\n` +
          'Draft a clear, helpful, friendly reply resolving this - no corporate jargon, ' +
          'get straight to helping. If the issue needs information you do not have, say so honestly ' +
          'and explain what you would need. Respond with ONLY a JSON object: ' +
          '{"to": "email or null if not found", "subject": "...", "body": "..."}',
      },
    ];
  }

  async reflect(task, results) {
    const draftStep = results[results.length - 1];
    let draft = null;

    try {
      const match = draftStep?.text?.match(/\{[\s\S]*\}/);
      if (match) draft = JSON.parse(match[0]);
    } catch (err) {
      console.warn(`[SupportAgent] failed to parse reply draft: ${err.message}`);
    }

    const to = draft?.to || extractEmail(task.instruction);
    let note;

    if (draft && to && draft.subject && draft.body) {
      await this.createApprovalTask({
        instruction: `Send support reply to ${to}`,
        tool: 'gmail.sendEmail',
        payload: { to, subject: draft.subject, body: draft.body },
      });
      note = `Drafted a support reply to ${to} — awaiting your approval on the Tasks page.`;
    } else {
      note = `Couldn't find a clear recipient email — mention the customer's email address and try again.`;
    }

    await memory.addReflection(this.role, task.id, note);
    return note;
  }
}

module.exports = SupportAgent;
