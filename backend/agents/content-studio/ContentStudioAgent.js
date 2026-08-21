const BaseAgent = require('../base/BaseAgent');
const memory = require('../../memory');
const config = require('../../config');

const ANTI_GENERIC =
  `Ground everything in the ACTUAL topic/business given - never generic marketing platitudes ` +
  `("elevate your brand", "take it to the next level", "unlock your potential"). Be specific: real ` +
  `pain points a real customer of this exact thing would have, real hooks that reference the actual ` +
  `subject, not filler that could apply to any business.`;

/**
 * ContentStudioAgent - takes one idea/topic/product and runs it through a
 * real content pipeline: research -> campaign strategy -> platform scripts
 * -> captions -> hashtags -> (optionally) a generated cover image. Text
 * generation needs no paid third-party API beyond what's already configured
 * (Tavily for research, if set). The cover image step only runs if
 * OPENAI_API_KEY is configured (gpt-image-1) - gracefully skipped otherwise,
 * same pattern as Tavily.
 *
 * Video/voice/music generation and multi-platform auto-publishing still each
 * need their own paid third-party accounts and a separate integration
 * effort - not attempted here.
 */
class ContentStudioAgent extends BaseAgent {
  constructor() {
    super({
      key: 'content-studio',
      role: 'Content Studio Agent',
      goals: ['Turn one idea into a complete, ready-to-use content package: research, strategy, scripts, captions, hashtags'],
      tools: ['websearch.search', 'youtube.search', 'imagegen.generateImage'],
    });
  }

  async plan(task) {
    const steps = [];

    if (config.search.tavilyKey) {
      steps.push({ type: 'tool_call', tool: 'websearch.search', args: { query: task.instruction, maxResults: 8 }, label: 'searchResults' });
    }
    if (config.search.youtubeKey) {
      steps.push({ type: 'tool_call', tool: 'youtube.search', args: { query: task.instruction, maxResults: 5 }, label: 'youtubeResults' });
    }

    steps.push({
      type: 'llm_call',
      label: 'research',
      maxTokens: 1400,
      instruction:
        `Topic: "${task.instruction}"\n\n` +
        `Research this like you're prepping a real campaign, not writing a book report. ${ANTI_GENERIC} ` +
        `If real YouTube search results are included above, ground your hooks in what's ACTUALLY performing well ` +
        `on that topic right now (titles, angles) rather than guessing.\n\n` +
        `Produce, as clearly labeled sections:\n` +
        `- Keywords (5-10 real search/social terms people would actually use)\n` +
        `- Hooks (4-5 specific opening lines that would stop a scroll for THIS topic)\n` +
        `- Pain points (3-4 real problems the audience actually has)\n` +
        `- Benefits (3-4 concrete, specific benefits - not vague adjectives)\n` +
        `- Calls-to-action (3-4 real CTAs suited to this specific thing)`,
    });

    steps.push({
      type: 'llm_call',
      label: 'strategy',
      maxTokens: 1000,
      instruction:
        `Based on the research above, write a campaign strategy for "${task.instruction}". ${ANTI_GENERIC}\n\n` +
        `Include:\n- Target audience (specific, not "everyone interested in X")\n` +
        `- Brand messaging (the one core message every asset should reinforce)\n` +
        `- Funnel recommendation (what happens after someone sees this - realistic for a small business, ` +
        `not an enterprise funnel diagram)\n- A simple content schedule (what to post over the next 2 weeks)`,
    });

    steps.push({
      type: 'llm_call',
      label: 'scripts',
      maxTokens: 2000,
      instruction:
        `Based on the research and strategy above, write 3 short-form video scripts for "${task.instruction}" - ` +
        `one for TikTok/Reels (~30 sec), one for YouTube Shorts, one for a longer-form platform video (~60 sec). ` +
        `Choose a tone that actually fits this specific topic (funny, professional, luxury, emotional, ` +
        `educational, or storytelling) and say which you chose and why. ${ANTI_GENERIC} Write them as if ` +
        `someone will read them straight into camera - real lines, not scene-direction summaries.`,
    });

    steps.push({
      type: 'llm_call',
      label: 'captions',
      maxTokens: 1200,
      instruction:
        `Based on everything above, write captions for "${task.instruction}" for: Instagram, LinkedIn, TikTok, ` +
        `and X. Match each platform's real norms (Instagram: warmer, some emojis, a question to drive comments; ` +
        `LinkedIn: professional, no excessive emojis; TikTok: short, punchy, casual; X: concise, fits in one ` +
        `post). Each needs a genuine call-to-action. ${ANTI_GENERIC}`,
    });

    steps.push({
      type: 'llm_call',
      label: 'hashtags',
      maxTokens: 600,
      instruction:
        `Based on everything above, generate hashtag sets for "${task.instruction}" for Instagram, TikTok, ` +
        `and LinkedIn (8-12 each). Ground them in the actual topic and research keywords - not generic tags ` +
        `like #business #marketing #entrepreneur that apply to literally anything.`,
    });

    if (config.llm.openaiKey) {
      steps.push({
        type: 'llm_call',
        label: 'imagePrompt',
        maxTokens: 300,
        instruction:
          `Based on everything above, write ONE detailed, specific image generation prompt for a cover/hero ` +
          `image for this campaign. Describe composition, mood, colors, and subject concretely - not "a ` +
          `marketing image for X", an actual visual description an image model could render well. Just the ` +
          `prompt itself, 2-4 sentences, nothing else - no preamble, no markdown.`,
      });
      steps.push({
        type: 'tool_call',
        tool: 'imagegen.generateImage',
        label: 'image',
        args: { projectId: `content-studio-${task.id}`, path: 'cover.png' }, // prompt is injected in execute() below, from the imagePrompt step's own output
      });
    }

    return steps;
  }

  // Thin override: reuse BaseAgent's execute() as-is for both tool_call and
  // llm_call, just tag each labeled result onto the task so reflect() can
  // assemble the final document by name instead of fragile array indexing.
  async execute(step, task, priorContext) {
    // tool_call steps don't get automatic prior-step-context threading the
    // way llm_call steps do, so the image prompt has to be injected here
    // explicitly from the imagePrompt step's own tagged output.
    if (step.type === 'tool_call' && step.tool === 'imagegen.generateImage') {
      step = { ...step, args: { ...step.args, prompt: task.imagePrompt || task.instruction } };
    }

    const result = await super.execute(step, task, priorContext);

    if (step.label === 'image') {
      task.imageResult = result;
    } else if (step.label && step.type === 'llm_call') {
      task[step.label] = result?.text || '';
    }
    return result;
  }

  async reflect(task, results) {
    const sections = [
      ['Research', task.research],
      ['Campaign Strategy', task.strategy],
      ['Video Scripts', task.scripts],
      ['Captions', task.captions],
      ['Hashtags', task.hashtags],
    ].filter(([, body]) => body);

    let combined = sections.map(([title, body]) => `## ${title}\n\n${body}`).join('\n\n---\n\n');
    let note = `Content package built for "${task.instruction}" - ${sections.length} section(s): ${sections.map(([t]) => t).join(', ')}.`;

    if (task.imageResult) {
      const imageUrl = `http://localhost:${config.port}/api/workspace/content-studio-${task.id}/file/${task.imageResult.path}`;
      combined += `\n\n---\n\n## Cover Image\n\n${task.imageResult.revisedPrompt}\n\n${imageUrl}`;
      note += ` Includes a generated cover image.`;
    }

    await memory.addReflection(this.role, task.id, note);

    // BaseAgent.run() returns `results` by reference, not reflect()'s return
    // value - push the combined document as the final text-bearing entry so
    // it surfaces in chat, same pattern as Research/Marketing/CEO/Coding.
    results.push({ text: combined });

    return combined;
  }
}

module.exports = ContentStudioAgent;
