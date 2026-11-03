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
 */
export const NAV_ITEMS = [
  {
    key: 'home',
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
    label: 'Work',
    icon: ListChecks,
    to: '/work',
    badgeKey: 'unreadTasks',
    tabs: [
      { label: 'Tasks', to: '/work', end: true, badgeKey: 'unreadTasks' },
      { label: 'Workflows', to: '/work/workflows' },
      { label: 'Clients', to: '/work/clients' },
      { label: 'Inbox', to: '/work/inbox' },
    ],
  },
  {
    key: 'departments',
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
    label: 'Toolbox',
    icon: Puzzle,
    to: '/toolbox',
    tabs: [
      { label: 'Plugins', to: '/toolbox', end: true },
      { label: 'Skills', to: '/toolbox/skills' },
      { label: 'Connections', to: '/toolbox/connections' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    to: '/settings',
    tabs: [
      { label: 'General', to: '/settings', end: true },
      { label: 'Team', to: '/settings/team' },
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
  '/plugins': '/toolbox',
  '/skills': '/toolbox/skills',
  '/connections': '/toolbox/connections',
  '/team': '/settings/team',
  '/agents': '/departments',
  '/outreach': '/departments/sales/outreach',
  '/research': '/departments/strategy/research',
  '/briefing-dashboard': '/departments/strategy/intelligence',
};
