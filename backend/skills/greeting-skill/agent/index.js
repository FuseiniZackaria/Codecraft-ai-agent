/**
 * Entry point contract for a CodeCraft skill: export a `tools` array.
 * Each tool gets registered into the running ToolRegistry exactly like a
 * built-in plugin action, callable as "<skillId>.<toolName>" once activated.
 */
module.exports = {
  tools: [
    {
      name: 'sayHello',
      permission: null,
      irreversible: false,
      async run({ name }) {
        return {
          message: `Hello, ${name || 'there'}! This greeting came from a dynamically installed skill.`,
        };
      },
    },
  ],
};
