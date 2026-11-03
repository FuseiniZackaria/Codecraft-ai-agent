const { FinishReason, ThinkingLevel } = require('@google/genai');
const config = require('../../config');
const gemini = require('./gemini');
const { startTimer } = require('../debugTiming');

/**
 * AiProvider - real adapter (Google Gemini), active only when GEMINI_API_KEY is set.
 * Implements the same interface as mockProvider so the router can swap them freely.
 */
// Per-model paid-tier prices live in one table (core/assistant/usage.js);
// the free tier costs nothing.
const { costOf } = require('../assistant/usage');

module.exports = {
  name: 'ai',
  costPerCall: 0.003, // rough static estimate, used only by router.js's provider-selection scoring - NOT the actual per-call cost, which complete() now computes for real below
  speed: 'fast',

  async complete({ prompt, system, maxTokens = 1000, history = [], content = null }) {
    if (!config.llm.geminiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // `content` lets a caller send a multimodal message (Gemini parts: images/PDFs
    // as inlineData plus text) - when omitted, falls back to a plain text `prompt`.
    const userParts = content || [{ text: prompt || '(no text)' }];

    // The API rejects ANY message with empty content - filter out history
    // entries that ended up blank (e.g. a past turn that was just an
    // attachment with no text).
    const cleanHistory = history.filter((h) => h.content && String(h.content).trim().length > 0);

    const contents = [
      ...cleanHistory.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.content) }] })),
      { role: 'user', parts: userParts },
    ];

    // Streamed internally (then collected) so a model that hasn't started
    // answering within the first-chunk deadline is abandoned for the fallback.
    const timer = startTimer('ai');
    let model;
    let text = '';
    let finishReason = null;
    let blockReason = null;
    let usage = {};
    try {
      const started = await gemini.startStream({
        model: config.llm.model,
        contents,
        config: {
          ...(system ? { systemInstruction: system } : {}),
          maxOutputTokens: maxTokens,
          // Low thinking keeps agent calls quick; thinking tokens count against maxOutputTokens.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      model = started.model;
      timer.mark('first chunk', { provider: 'gemini', model, tools: 0, thinking: 'LOW', attempts: started.attempts });
      for await (const chunk of started.chunks) {
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
        if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        for (const part of candidate?.content?.parts || []) if (part.text && !part.thought) text += part.text;
      }
    } catch (err) {
      throw new Error(`AI provider error: ${err.message}`);
    }

    timer.mark('done', { model, chars: text.length });
    const truncated = finishReason === FinishReason.MAX_TOKENS;
    if (truncated) {
      console.warn(`[ai] response truncated by max_tokens (${maxTokens}) - consider raising it for this call`);
    }
    if (!text && blockReason) {
      throw new Error(`AI provider error: request blocked (${blockReason})`);
    }

    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
    const costEstimate = costOf(model, { input_tokens: inputTokens, output_tokens: outputTokens });
    return {
      provider: 'ai',
      text,
      costEstimate,
      inputTokens,
      outputTokens,
      truncated,
    };
  },
};
