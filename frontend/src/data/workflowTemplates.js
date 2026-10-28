// Every goal phrasing here has been verified to route to the intended agent
// (via intentClassifier.js's own examples, or direct testing earlier in
// this build). We don't have dedicated HR/Finance agents - those two
// categories honestly reuse the CEO Agent (strategy/priorities) and
// Research Agent (market/benchmark lookups), which are genuinely
// general-purpose enough to serve those contexts well, just labeled
// accurately rather than implying specialized agents that don't exist.

export const WORKFLOW_TEMPLATES = [
  {
    id: 'sales-lead-finder',
    category: 'Sales',
    name: 'Daily Lead Finder',
    description: 'Finds businesses that need what you offer and drafts personalized outreach - each draft waits for your approval before sending.',
    agentNote: 'Sales Agent',
    goal: 'Find businesses that need [describe your product or service] and draft personalized outreach',
    scheduleType: 'daily',
    dailyTime: '09:00',
    daysOfWeek: [1, 2, 3, 4, 5],
  },
  {
    id: 'marketing-content-campaign',
    category: 'Marketing',
    name: 'Weekly Content Campaign',
    description: 'Turns one idea into a full content package - research, strategy, platform scripts, captions, and hashtags.',
    agentNote: 'Content Studio Agent',
    goal: "Create a campaign for [your product, service, or this week's offer]",
    scheduleType: 'daily',
    dailyTime: '08:00',
    daysOfWeek: [1],
  },
  {
    id: 'support-inbox-triage',
    category: 'Customer Support',
    name: 'Inbox Auto-Triage',
    description: 'Checks your inbox and drafts replies to what genuinely needs one - each reply waits for your approval before sending.',
    agentNote: 'Personal Assistant Agent',
    goal: 'Check my inbox and reply to what needs a reply',
    scheduleType: 'interval',
    intervalMinutes: 30,
  },
  {
    id: 'dev-tech-trend-watch',
    category: 'Development',
    name: 'Tech Trend Watch',
    description: 'Keeps you current on tools and libraries relevant to your stack, so nothing important slips by.',
    agentNote: 'Research Agent',
    goal: 'Research trending tools and libraries relevant to [your tech stack or industry]',
    scheduleType: 'daily',
    dailyTime: '09:00',
    daysOfWeek: [1],
  },
  {
    id: 'hr-hiring-checkin',
    category: 'HR',
    name: 'Hiring Priorities Check-in',
    description: 'A real strategic recommendation, not a generic checklist - reasons through your actual hiring tradeoffs like a co-founder would.',
    agentNote: 'CEO Agent (no dedicated HR agent exists yet)',
    goal: 'Should we prioritize hiring for [role] this quarter, given our current situation?',
    scheduleType: 'daily',
    dailyTime: '09:00',
    daysOfWeek: [1],
  },
  {
    id: 'finance-market-watch',
    category: 'Finance',
    name: 'Pricing & Market Watch',
    description: 'Tracks current market pricing for your category, so your own pricing stays grounded in reality.',
    agentNote: 'Research Agent (no dedicated Finance agent exists yet)',
    goal: 'Research current market pricing for [your product or service category]',
    scheduleType: 'daily',
    dailyTime: '09:00',
    daysOfWeek: [1],
  },
  {
    id: 'productivity-weekly-priorities',
    category: 'Personal Productivity',
    name: 'Weekly Priorities Check-in',
    description: 'A real, reasoned answer to "what should I focus on" - not a to-do list generator.',
    agentNote: 'CEO Agent',
    goal: "What should I prioritize this week, given [what's currently on your plate]?",
    scheduleType: 'daily',
    dailyTime: '08:00',
    daysOfWeek: [1],
  },
];
