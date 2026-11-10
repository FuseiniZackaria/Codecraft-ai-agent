/**
 * "Open the Sales page" / "take me to Leads" - switch the app to that page.
 *
 * Ian picks from a fixed list of the app's pages (the `page` enum below), so
 * he can never send the browser somewhere that doesn't exist. The result
 * carries `ui` = { action: 'navigate', path }, which goes to the user's
 * browser only (core/assistant/index.js strips it before the AI sees it).
 *
 * Keep in step with frontend/src/components/nav/navConfig.js and
 * frontend/src/data/departmentConfig.js.
 */

const PAGES = {
  home: { path: '/home', label: 'Home' },
  analytics: { path: '/home/analytics', label: 'Analytics' },
  chat: { path: '/chat', label: 'Chat' },
  console: { path: '/chat/console', label: 'Console' },
  tasks: { path: '/work', label: 'Tasks' },
  workflows: { path: '/work/workflows', label: 'Workflows' },
  clients: { path: '/work/clients', label: 'Clients' },
  inbox: { path: '/work/inbox', label: 'WhatsApp Inbox' },
  leads: { path: '/work/leads', label: 'Leads' },
  departments: { path: '/departments', label: 'Departments' },
  sales: { path: '/departments/sales', label: 'Sales' },
  sales_outreach: { path: '/departments/sales/outreach', label: 'Sales - Outreach' },
  sales_approvals: { path: '/departments/sales/approvals', label: 'Sales - Approvals' },
  marketing: { path: '/departments/marketing', label: 'Marketing' },
  support: { path: '/departments/support', label: 'Support' },
  strategy: { path: '/departments/strategy', label: 'Strategy' },
  research: { path: '/departments/strategy/research', label: 'Strategy - Research' },
  intelligence: { path: '/departments/strategy/intelligence', label: 'Strategy - Intelligence' },
  development: { path: '/departments/development', label: 'Development' },
  connections: { path: '/toolbox/connections', label: 'Connections' },
  skills: { path: '/toolbox/skills', label: 'Skills' },
  settings: { path: '/settings', label: 'Settings' },
  business_profile: { path: '/settings', label: 'Settings (Business Profile)' },
  team: { path: '/settings/team', label: 'Team' },
  clients: { path: '/settings/clients', label: 'Clients (app owner only)' },
};

function openPage(input = {}) {
  const key = String(input.page || '').trim().toLowerCase();
  const page = PAGES[key];
  if (!page) {
    return { ok: false, error: `There's no "${input.page}" page.`, pages: Object.values(PAGES).map((p) => p.label) };
  }
  return {
    ok: true,
    opened: true,
    page: page.label,
    note: `The ${page.label} page is now open on the user's screen.`,
    ui: { action: 'navigate', path: page.path },
  };
}

const DEFINITION = {
  name: 'open_page',
  description:
    'Switch the app on the user\'s screen to one of its pages. Use it whenever the user asks to open / show / go to / take them to a page or section ' +
    '(e.g. "open the sales page" -> sales, "show my leads" -> leads, "go to settings" -> settings, "my pending approvals page" -> tasks). ' +
    'For one person\'s WhatsApp chat use open_whatsapp_chat instead.',
  input_schema: {
    type: 'object',
    properties: {
      page: { type: 'string', enum: Object.keys(PAGES), description: 'Which page to open.' },
    },
    required: ['page'],
  },
};

module.exports = { openPage, DEFINITION, PAGES };
