/**
 * Tool definitions for the conversational Assistant.
 *
 * Each department becomes ONE tool, not each agent - the orchestrator's
 * existing classifier picks the right agent within a department from the
 * instruction text, so Claude only needs to decide which department.
 *
 * These definitions are STATIC and get cache_control: ephemeral on the
 * request, so they count as a fixed prefix for prompt caching.
 */

const DEPARTMENT_TOOLS = [
  {
    name: 'run_sales_task',
    description:
      'Run a Sales & Outreach task: find leads, verify opportunities, draft personalised cold-outreach, draft job applications. ' +
      'Irreversible actions (sending emails, posting) create a pending_approval task - they NEVER send without the user explicitly approving on the Tasks page.',
    department: 'sales',
  },
  {
    name: 'run_marketing_task',
    description:
      'Run a Marketing & Content task: draft a single piece of marketing content (one email, one social post, one tagline, one ad), ' +
      'or build a full content package (research + strategy + scripts + captions + hashtags) for one topic.',
    department: 'marketing',
  },
  {
    name: 'run_support_task',
    description:
      'Run a Customer Support & Communication task: triage the Gmail inbox and draft replies, respond to a specific customer question, ' +
      'send a WhatsApp or Telegram message, or book a calendar event. Messaging actions create pending_approval tasks.',
    department: 'support',
  },
  {
    name: 'run_strategy_task',
    description:
      'Run a Strategy & Research task: look up information via web search, think through a strategy/priorities/tradeoff question with a real recommendation, ' +
      'or combine multiple topics/sources into one merged brief.',
    department: 'strategy',
  },
  {
    name: 'run_development_task',
    description:
      'Run a Development & Operations task: build a website/app/system (writes real files to a sandboxed workspace), create a GitHub repo, ' +
      'find/open/delete files on the user\'s own computer (within allowed folders), or browse a specific website. ' +
      'GitHub repo creation and file deletion create pending_approval tasks.',
    department: 'development',
  },
];

const INSTRUCTION_SCHEMA = {
  type: 'object',
  properties: {
    instruction: {
      type: 'string',
      description:
        'The natural-language task to run, phrased the way the user would phrase it. ' +
        'Preserve concrete details (names, URLs, numbers, locations) from the conversation.',
    },
  },
  required: ['instruction'],
};

function toolDefinition(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: INSTRUCTION_SCHEMA,
  };
}

const UTILITY_TOOLS = [
  {
    name: 'list_pending_approvals',
    description:
      "List tasks currently waiting for the user's approval (anything drafted but not yet sent). Use this when the user asks what's pending or what they need to review.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'check_task_result',
    description:
      'Fetch the latest status and result of a task you created earlier in this conversation. Useful when the user asks "what did it find" or "did that work".',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task id returned from a previous tool call.' },
      },
      required: ['task_id'],
    },
  },
];

/**
 * Build the tool list sent to Claude.
 * @param {string|null} scope - department key, or null for the global Assistant.
 */
function buildTools(scope) {
  if (!scope) {
    return [...DEPARTMENT_TOOLS.map(toolDefinition), ...UTILITY_TOOLS];
  }
  const scoped = DEPARTMENT_TOOLS.filter((t) => t.department === scope).map(toolDefinition);
  return [...scoped, ...UTILITY_TOOLS];
}

function departmentForTool(toolName) {
  return DEPARTMENT_TOOLS.find((t) => t.name === toolName)?.department || null;
}

module.exports = { buildTools, departmentForTool, DEPARTMENT_TOOLS, UTILITY_TOOLS };
