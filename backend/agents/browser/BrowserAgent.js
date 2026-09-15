const BaseAgent = require('../base/BaseAgent');
const { selectProvider } = require('../../core/router');

class BrowserAgent extends BaseAgent {
  constructor() {
    super({
      key: 'browser',
      role: 'Browser Agent',
      goals: ['Navigate to specific web pages the user names and report back what is actually there - read-only, no clicking or form submission yet'],
      tools: ['browser.navigate', 'browser.readPage', 'browser.screenshot'],
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
          'is up, reading its content, or describing what is on it.',
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

    return [
      { type: 'tool_call', tool: 'browser.navigate', args: { url: extracted.url } },
      { type: 'tool_call', tool: 'browser.readPage', args: {} },
      {
        type: 'llm_call',
        maxTokens: 800,
        instruction:
          'The previous step\'s result is a JSON object: "url", "title", "text" (the page\'s visible text ' +
          'content, possibly truncated), "truncated" (true if the page had more text than shown). Summarize ' +
          'what this page actually says for the user in a friendly, concise way - report the page title and ' +
          'the substance of its content. If "truncated" is true, mention the page had more content than what ' +
          'was reviewed. Never claim to have seen images/layout/visual design - only the text content was read.',
      },
    ];
  }
}

module.exports = BrowserAgent;