const https = require('https');
const config = require('../../config');

/**
 * AiProvider - real adapter, active only when AI_API_KEY is set.
 * Implements the same interface as mockProvider so the router can swap them freely.
 */
module.exports = {
  name: 'ai',
  costPerCall: 0.003, // rough per-call estimate, used by the router's scoring fn
  speed: 'fast',

  async complete({ prompt, system, maxTokens = 1000, history = [], content = null }) {
    if (!config.llm.aiApiKey) {
      throw new Error('AI_API_KEY not configured');
    }

    // `content` lets a caller send a multimodal message (images/PDFs plus
    // text) - when omitted, falls back to a plain text `prompt` as before.
    const userContent = content || prompt || '(no text)';

    // The API rejects ANY message with empty content - filter out history
    // entries that ended up blank (e.g. a past turn that was just an
    // attachment with no text).
    const cleanHistory = history.filter((h) => h.content && String(h.content).trim().length > 0);

    const messages = [
      ...cleanHistory.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userContent },
    ];

    // NOTE: hostname, path, header names, and model string below are
    // required exactly as-is by the underlying provider's API contract -
    // they can't be renamed/genericized without breaking the actual call.
    const body = JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      system,
      messages,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.llm.aiApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode >= 400) {
                const msg = parsed?.error?.message || `HTTP ${res.statusCode}`;
                return reject(new Error(`AI provider error: ${msg}`));
              }
              const text = (parsed.content || []).map((c) => c.text || '').join('\n');
              if (parsed.stop_reason === 'max_tokens') {
                console.warn(`[ai] response truncated by max_tokens (${maxTokens}) - consider raising it for this call`);
              }
              resolve({ provider: 'ai', text, costEstimate: this.costPerCall, truncated: parsed.stop_reason === 'max_tokens' });
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  },
};
