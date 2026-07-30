const composio = require('../../../core/composio');

module.exports = {
  name: 'createRepository',
  permission: 'github.write',
  irreversible: true, // creates a real, publicly-visible (unless private) repo

  async run({ name, description, private: isPrivate = false }) {
    if (!name) {
      throw new Error('createRepository requires "name"');
    }
    const result = await composio.execute(
      'GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER',
      { name, description: description || '', private: !!isPrivate },
      'github'
    );
    return { status: 'created', name, ...result };
  },
};
