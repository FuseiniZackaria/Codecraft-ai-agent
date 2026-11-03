const BaseAgent = require('../base/BaseAgent');
const { selectProvider } = require('../../core/router');

class BrowserAgent extends BaseAgent {
  constructor() {
    super({
      key: 'browser',
      role: 'Browser Agent',
      goals: ['Navigate to specific web pages the user names and report back what is actually there, including every contact detail on the site - read-only, no clicking or form submission yet'],
      tools: ['browser.navigate', 'browser.readPage', 'browser.findContacts', 'browser.screenshot'],
    });
  }

  async plan(task) {
    let extracted = null;
    try {
      const provider = selectProvider({});
      const result = await provider.complete({
        maxTokens: 200,
        system:
          'Figure out what the user wants done with a web page. Respond with ONLY a JSON object: ' +
          '{"url": "...", "mode": "read"|"screenshot"}. Extract the exact URL mentioned or clearly implied ' +
          '(add "https://" if the user wrote a bare domain like "example.com"). Use "screenshot" only when ' +
          'the user explicitly asks to SEE, capture, or take a screenshot/picture of the page - otherwise ' +
          'default to "read" (get the actual text content and summarize it), which covers checking if a site ' +
          'is up, reading its content, describing what is on it, or finding its contact details.',
        prompt: `Current message: ${task.instruction}`,
      });
      const match = result.text.match(/\{[\s\S]*\}/);
      extracted = match ? JSON.parse(match[0]) : null;
    } catch (err) {
      console.warn(`[BrowserAgent] extraction failed: ${err.message}`);
    }

    const hasUrl = extracted?.url && typeof extracted.url === 'string' && extracted.url.trim();

    if (!hasUrl) {
      return [
        {
          type: 'llm_call',
          maxTokens: 150,
          instruction: `Ask the user which specific website or URL they want visited - could not tell from: "${task.instruction}".`,
        },
      ];
    }

    if (extracted.mode === 'screenshot') {
      return [
        { type: 'tool_call', tool: 'browser.navigate', args: { url: extracted.url } },
        { type: 'tool_call', tool: 'browser.screenshot', args: {} },
        {
          type: 'llm_call',
          maxTokens: 200,
          instruction:
            'The previous step\'s result is a JSON object with a base64-encoded screenshot and the page URL/' +
            'status. Tell the user plainly that a screenshot of the page was captured - do not attempt to ' +
            'describe the visual content itself (you cannot see the image), just confirm success and the URL.',
        },
      ];
    }

    // findContacts loads the page fully (scrolls to the footer), reads all of
    // it, and - if there's no email on it - opens the site's contact/about
    // page too. Its text starts and ends with a CONTACT DETAILS FOUND block.
    return [
      { type: 'tool_call', tool: 'browser.findContacts', args: { url: extracted.url } },
      {
        type: 'llm_call',
        maxTokens: 1000,
        instruction:
          `The user asked: "${task.instruction}"\n\n` +
          'The previous step is the text of the website (one or more pages, each starting with "PAGE: <url>"), ' +
          'with a "=== CONTACT DETAILS FOUND ===" block at the start and end. Reply in this order:\n' +
          '1. A line "Contact details:" followed by every email and phone number from that block, copied exactly ' +
          'as written - never shorten, guess, or invent one. If the block says "none found" for both, write ' +
          '"Contact details: none found on <the pages checked>".\n' +
          '2. A short, friendly summary of what the site says, answering the user\'s question.\n' +
          'Only the text content was read - never claim to have seen images, layout or visual design.',
      },
    ];
  }
}

module.exports = BrowserAgent;
