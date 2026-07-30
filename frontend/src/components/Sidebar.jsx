import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Bot, ListChecks, Puzzle, MessageSquare, Workflow, Search, Terminal, Package } from 'lucide-react';
import Logo from './Logo';
import { useStore } from '../store/useStore';

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/skills', label: 'Skills', icon: Package },
  { to: '/console', label: 'Console', icon: Terminal },
  { to: '/tasks', label: 'Tasks', icon: ListChecks, badgeKey: 'pendingCount' },
  { to: '/research', label: 'Research', icon: Search },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/plugins', label: 'Plugins', icon: Puzzle },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
];

export default function Sidebar() {
  const tasks = useStore((s) => s.tasks);
  const pendingCount = tasks.filter((t) => t.status === 'pending_approval').length;
  const badgeValues = { pendingCount };

  return (
    <aside className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
      <div className="flex items-center gap-2 px-5 h-14 border-b border-[var(--color-border)]">
        <Logo />
        <span className="font-[var(--font-display)] font-semibold tracking-tight text-[15px]">
          CodeCraft<span className="text-[var(--color-accent)]">AI</span>
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {links.map(({ to, label, icon: Icon, end, badgeKey }) => {
          const badge = badgeKey ? badgeValues[badgeKey] : 0;
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]/60'
                }`
              }
            >
              <Icon size={16} strokeWidth={1.75} />
              <span className="flex-1">{label}</span>
              {badge > 0 && (
                <span className="text-[10px] font-[var(--font-mono)] font-semibold min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-accent)] text-black flex items-center justify-center">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)]">
        Build. Automate. Scale.
      </div>
    </aside>
  );
}
