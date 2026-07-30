const composio = require('../../../core/composio');

module.exports = {
  name: 'createOrUpdateFile',
  permission: 'github.write',
  irreversible: true, // creates a real commit on the target repo/branch

  async run({ owner, repo, path, message, content, branch, sha }) {
    const fields = { owner, repo, path, message, content };
    const missing = Object.entries(fields)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      throw new Error(`createOrUpdateFile is missing: ${missing.join(', ')}`);
    }

    // GitHub's contents API requires base64-encoded content - encode plain
    // text here so callers can just pass normal text.
    const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

    const result = await composio.execute(
      'GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS',
      {
        owner,
        repo,
        path,
        message,
        content: encodedContent,
        ...(branch ? { branch } : {}),
        ...(sha ? { sha } : {}), // required only when updating an existing file
      },
      'github'
    );
    return { status: 'committed', path, ...result };
  },
};
