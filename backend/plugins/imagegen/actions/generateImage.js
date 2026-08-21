const fs = require('fs');
const path = require('path');
const config = require('../../../config');
const { resolveSafePath, ensureProjectDir } = require('../../filesystem/workspaceSafety');

// DALL-E 3 was retired March 2026 - gpt-image-1 is the current, well-documented
// model. Configurable via env var since this space moves fast and a newer
// model (e.g. gpt-image-2) may be worth switching to without a code change.
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

module.exports = {
  name: 'generateImage',
  permission: 'imagegen',
  irreversible: false, // writes a local sandboxed file only - no real-world side effect, no approval gate needed

  async run({ prompt, projectId, path: relativePath, size = '1024x1024' }) {
    if (!config.llm.openaiKey) {
      throw new Error('Image generation not configured - set OPENAI_API_KEY in .env');
    }
    if (!prompt || !projectId || !relativePath) {
      throw new Error('generateImage requires "prompt", "projectId", and "path"');
    }

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.llm.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: DEFAULT_MODEL, prompt, n: 1, size }),
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || `OpenAI Image API error (HTTP ${res.status})`);
    }

    const image = json.data?.[0];
    if (!image) throw new Error('OpenAI Image API returned no image data');

    // Handle both possible response shapes defensively - different model
    // versions have returned b64_json vs url inconsistently across this API's
    // history, and this isn't something worth breaking over.
    let base64 = image.b64_json;
    if (!base64 && image.url) {
      const imgRes = await fetch(image.url);
      if (!imgRes.ok) throw new Error(`Failed to download generated image (HTTP ${imgRes.status})`);
      base64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
    }
    if (!base64) throw new Error('OpenAI Image API response had neither b64_json nor url');

    ensureProjectDir(projectId);
    const target = resolveSafePath(projectId, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, base64, 'base64');

    return { path: relativePath, revisedPrompt: image.revised_prompt || prompt, bytes: fs.statSync(target).size };
  },
};
