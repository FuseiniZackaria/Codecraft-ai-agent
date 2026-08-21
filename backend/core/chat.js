const orchestrator = require('./orchestrator');
const { classifyIntent } = require('./intentClassifier');
const { selectProvider } = require('./router');
const { businessContextLine } = require('./businessContext');
const store = require('../memory');
const { isExtractable, extractText } = require('./documentExtractor');

const REMEMBER_TRIGGERS = ['remember that', 'remember this', "don't forget", 'never forget', 'always remember'];

function isRememberIntent(message) {
  const lower = message.toLowerCase();
  return REMEMBER_TRIGGERS.some((t) => lower.includes(t));
}

async function factsLine() {
  const facts = await store.getFacts();
  if (!facts.length) return '';
  return `Things you've been explicitly told to remember:\n${facts.map((f) => `- ${f.fact}`).join('\n')}\n\n`;
}

function buildSystemPrompt(facts) {
  return (
    `${businessContextLine()}${facts}You are the assistant inside CodeCraft AI, a business automation platform. ` +
    `You're chatting conversationally with the business owner - be warm, direct, and concise, like a ` +
    `sharp colleague, not a formal support bot. Two kinds of real actions happen outside this direct reply: ` +
    `research/lookups run immediately and their findings get reported back to you right here in chat - ` +
    `you never need to tell the user to "go submit a request" for those, it already happened. Irreversible ` +
    `actions (sending an email, replying, WhatsApp messages) instead get drafted and paused for the user's ` +
    `explicit approval on the Tasks page - for those, tell them it's drafted and waiting. For everything ` +
    `else - questions, brainstorming, small talk - just respond naturally from your own knowledge.`
  );
}

const ALLOWED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

function buildMultimodalContent(message, attachments) {
  const blocks = attachments.map((a) => {
    if (a.mediaType === 'application/pdf') {
      return { type: 'document', source: { type: 'base64', media_type: a.mediaType, data: a.data } };
    }
    return { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } };
  });
  blocks.push({ type: 'text', text: message || 'What is this?' });
  return blocks;
}

/**
 * Handles one chat turn.
 * - "Remember that X" style messages are stored permanently (Supabase-backed,
 *   survives restarts and new sessions) and injected into every future
 *   system prompt - no task created.
 * - Attachments (images/PDFs) always get a direct multimodal analysis reply -
 *   looking at a file isn't an irreversible action, so it never creates a task.
 * - Genuinely actionable messages (send an email, triage inbox, research)
 *   go through the full orchestrator and create a real, trackable task.
 * - Everything else gets a direct conversational reply.
 *
 * @param {string} message
 * @param {Array<{role: 'user'|'assistant', content: string}>} history
 * @param {Array<{mediaType: string, data: string, filename: string}>} attachments - base64-encoded
 */
async function handleMessage(message, history = [], attachments = []) {
  if (attachments.length) {
    const unsupported = attachments.filter((a) => !ALLOWED_ATTACHMENT_TYPES.includes(a.mediaType) && !isExtractable(a.mediaType));
    if (unsupported.length) {
      return {
        reply:
          `I can read images (JPEG/PNG/GIF/WebP), PDFs, Word docs (.docx), and Excel files (.xlsx/.xls) - ` +
          `${unsupported.map((a) => a.filename).join(', ')} isn't a format I can open.`,
        actionable: false,
        task: null,
      };
    }

    const nativeAttachments = attachments.filter((a) => ALLOWED_ATTACHMENT_TYPES.includes(a.mediaType));
    const documentAttachments = attachments.filter((a) => isExtractable(a.mediaType));

    // Word/Excel aren't formats Claude's API can read directly - extract
    // their text/data server-side first and fold it into the text prompt,
    // rather than trying to send the raw file.
    let extractedText = '';
    const extractionErrors = [];
    for (const doc of documentAttachments) {
      try {
        const text = await extractText(doc);
        extractedText += `\n\n--- Content of ${doc.filename} ---\n${text}`;
      } catch (err) {
        extractionErrors.push(`${doc.filename}: ${err.message}`);
      }
    }

    const provider = selectProvider({});
    const facts = await factsLine();
    const combinedMessage = (message || 'What is this?') + extractedText;

    const result = nativeAttachments.length
      ? await provider.complete({
          content: buildMultimodalContent(combinedMessage, nativeAttachments),
          system: buildSystemPrompt(facts),
          maxTokens: 2000,
        })
      : await provider.complete({ prompt: combinedMessage, system: buildSystemPrompt(facts), maxTokens: 2000 });

    const errorNote = extractionErrors.length ? `\n\n(Couldn't read: ${extractionErrors.join('; ')})` : '';
    return { reply: result.text + errorNote, actionable: false, task: null };
  }

  if (isRememberIntent(message)) {
    await store.addFact(message);
    return { reply: `Got it — I'll remember that.`, actionable: false, task: null, remembered: true };
  }

  const { category, isActionable } = await classifyIntent(message, history);

  if (isActionable) {
    const [task] = await orchestrator.submitGoal(message, { history, category });
    return { reply: describeTaskOutcome(task), actionable: true, task };
  }

  const provider = selectProvider({});
  const facts = await factsLine();
  const result = await provider.complete({
    prompt: message,
    system: buildSystemPrompt(facts),
    history,
    maxTokens: 1024,
  });

  return { reply: result.text, actionable: false, task: null };
}

function describeTaskOutcome(task) {
  if (task.status === 'pending_approval') {
    return `I've drafted that and it's waiting on your approval — check the Tasks page when you're ready to review and send it.`;
  }
  if (task.status === 'failed') {
    return `That didn't go through: ${task.result?.error || 'unknown error'}.`;
  }
  if (task.agent === 'personal-assistant') {
    const note = Array.isArray(task.result) ? task.result[task.result.length - 1] : null;
    return note?.text || note || `Done triaging your inbox — check the Tasks page for anything awaiting approval.`;
  }
  if (task.agent === 'research' || task.agent === 'marketing' || task.agent === 'ceo' || task.agent === 'coding' || task.agent === 'content-studio') {
    // Both run immediately with no approval step - surface the actual
    // output here rather than pointing to the Tasks page for something
    // that already fully completed.
    const steps = Array.isArray(task.result) ? task.result : [];
    const lastText = [...steps].reverse().find((s) => s?.text)?.text;
    return lastText || `Couldn't produce anything useful for that — try rephrasing or being more specific.`;
  }
  return `Done — check the Tasks page for the full result.`;
}

module.exports = { handleMessage };
