/**
 * The post that goes with a finished video: caption and hashtags, written by
 * Content Studio's own caption and hashtag steps (agents/content-studio),
 * from what was actually said in the video and the call to action.
 */

const PLATFORM_NAMES = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };

async function write({ workspaceId, transcript, answers = {}, brandVoice = null, partTitle = null }) {
  const ContentStudioAgent = require('../../agents/content-studio/ContentStudioAgent');
  const { selectProvider } = require('../router');
  const { businessContextLine } = require('../businessContext');
  const platform = PLATFORM_NAMES[answers.platform] || 'Instagram';
  const topic = partTitle || String(transcript || '').split(/(?<=[.!?])\s/)[0].slice(0, 120) || 'this video';
  const business = (await businessContextLine(workspaceId).catch(() => '')).trim();
  const context = [
    business,
    brandVoice ? `Brand voice: ${brandVoice}` : '',
    `What is said in the video: "${String(transcript || '').slice(0, 6000)}"`,
    answers.cta ? `What viewers should do at the end: ${answers.cta}` : '',
  ].filter(Boolean).join('\n\n');

  const provider = selectProvider({});
  const caption = await provider.complete({
    maxTokens: 700,
    system: 'You write social media posts for a small business video. Plain text, no markdown headings.',
    prompt: `${context}\n\n${ContentStudioAgent.captionsInstruction(topic, [platform])} Write only the ${platform} caption, ending with the call to action above.`,
  });
  const hashtags = await provider.complete({
    maxTokens: 300,
    system: 'You write hashtags for a small business video. Output only the hashtags, separated by spaces.',
    prompt: `${context}\n\n${ContentStudioAgent.hashtagsInstruction(topic, [platform])} Output one set for ${platform} only.`,
  });
  const tags = String(hashtags.text || '').match(/#[\p{L}\p{N}_]+/gu) || [];
  return {
    platform,
    caption: String(caption.text || '').trim(),
    hashtags: [...new Set(tags)].slice(0, 15),
  };
}

module.exports = { write };
