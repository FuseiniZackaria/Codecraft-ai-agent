import {
  LayoutGrid, MessageSquare, ListChecks, Building2, Puzzle, Settings,
  TrendingUp, Megaphone, Headphones, Compass, Code2,
} from 'lucide-react';

/**
 * The one navigation config. The desktop sidebar, the tablet rail, the phone
 * drawer and every page's tab bar all read from here, so they never drift.
 *
 * - `tabs`: the parent page's tabs. The first tab lives at the parent path
 *   (`end: true`); the others are nested routes (e.g. /work/workflows).
 * - `children`: a collapsible group (Departments) instead of tabs.
 * - `badgeKey`: which live count to show next to the item.
 * - `group`: the sidebar section heading the item sits under.
 */
export const NAV_ITEMS = [
  {
    key: 'home',
    group: 'Main navigation',
    label: 'Home',
    icon: LayoutGrid,
    to: '/home',
    tabs: [
      { label: 'Overview', to: '/home', end: true },
      { label: 'Analytics', to: '/home/analytics' },
    ],
  },
  {
    key: 'chat',
    group: 'Main navigation',
    label: 'Chat',
    icon: MessageSquare,
    to: '/chat',
    tabsVariant: 'segmented',
    tabs: [
      { label: 'Chat', to: '/chat', end: true },
      { label: 'Console', to: '/chat/console' },
    ],
  },
  {
    key: 'work',
    group: 'Main navigation',
    label: 'Work',
    icon: ListChecks,
    to: '/work',
    badgeKey: 'unreadTasks',
    tabs: [
      { label: 'Tasks', to: '/work', end: true, badgeKey: 'unreadTasks' },
      { label: 'Workflows', to: '/work/workflows' },
      { label: 'Clients', to: '/work/clients' },
      { label: 'Inbox', to: '/work/inbox' },
      { label: 'Leads', to: '/work/leads' },
    ],
  },
  {
    key: 'departments',
    group: 'Main navigation',
    label: 'Departments',
    icon: Building2,
    to: '/departments',
    children: [
      { label: 'Sales', to: '/departments/sales', icon: TrendingUp },
      { label: 'Marketing', to: '/departments/marketing', icon: Megaphone },
      { label: 'Support', to: '/departments/support', icon: Headphones },
      { label: 'Strategy', to: '/departments/strategy', icon: Compass },
      { label: 'Development', to: '/departments/development', icon: Code2 },
    ],
  },
  {
    key: 'toolbox',
    group: 'Tools & settings',
    label: 'Toolbox',
    icon: Puzzle,
    to: '/toolbox',
    tabs: [
      { label: 'Connections', to: '/toolbox/connections' },
      { label: 'Skills', to: '/toolbox/skills' },
      // Each person connects only their OWN computer (Computer Helper).
      { label: 'My computer', to: '/toolbox/computer' },
    ],
  },
  {
    key: 'settings',
    group: 'Tools & settings',
    label: 'Settings',
    icon: Settings,
    to: '/settings',
    tabs: [
      { label: 'General', to: '/settings', end: true },
      // The owner role only (migration 0013): team members and everyone's API usage.
      { label: 'Team', to: '/settings/team', ownerRoleOnly: true },
      // Only the app owner (APP_OWNER_EMAIL) sees this tab: every client business's WhatsApp.
      { label: 'Clients', to: '/settings/clients', ownerOnly: true },
    ],
  },
];

export const navItem = (key) => NAV_ITEMS.find((item) => item.key === key);

/**
 * Old URLs -> where those pages live now. Query strings and #hashes are kept
 * (Connections reads ?connected= after a Google sign-in returns to /connections).
 */
export const REDIRECTS = {
  '/': '/home',
  '/analytics': '/home/analytics',
  '/console': '/chat/console',
  '/tasks': '/work',
  '/workflows': '/work/workflows',
  '/client-tracker': '/work/clients',
  '/inbox': '/work/inbox',
  '/plugins': '/toolbox/connections', // the Plugins page was removed (Connections replaced it)
  '/skills': '/toolbox/skills',
  '/connections': '/toolbox/connections',
  '/team': '/settings/team',
  '/agents': '/departments',
  '/outreach': '/departments/sales/outreach',
  '/research': '/departments/strategy/research',
  '/briefing-dashboard': '/departments/strategy/intelligence',
};
