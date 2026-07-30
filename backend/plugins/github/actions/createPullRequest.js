const composio = require('../../../core/composio');

module.exports = {
  name: 'createPullRequest',
  permission: 'github.write',
  irreversible: true, // opens a real, publicly-visible pull request

  async run({ owner, repo, head, base, title, body, draft }) {
    const fields = { owner, repo, head, base };
    const missing = Object.entries(fields)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      throw new Error(`createPullRequest is missing: ${missing.join(', ')} (head/base branches must already exist)`);
    }

    const result = await composio.execute(
      'GITHUB_CREATE_A_PULL_REQUEST',
      {
        owner,
        repo,
        head,
        base,
        title: title || `Merge ${head} into ${base}`,
        body: body || '',
        draft: !!draft,
      },
      'github'
    );
    return { status: 'opened', head, base, ...result };
  },
};
