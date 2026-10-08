import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ListChecks, MessageSquare, Workflow,
  Terminal, Package, BarChart3, Puzzle, LogOut,
  TrendingUp, Megaphone, Headphones, Compass, Code2, Building2,
} from 'lucide-react';
import Logo from './Logo';
import { useStore } from '../store/useStore';

const appLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/console', label: 'Console', icon: Terminal },
  { to: '/tasks', label: 'Tasks', icon: ListChecks, badgeKey: 'pendingCount' },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/plugins', label: 'Plugins', icon: Puzzle },
  { to: '/skills', label: 'Skills', icon: Package },
];

const deptLinks = [
  { to: '/departments/sales', label: 'Sales Manager', icon: TrendingUp },
  { to: '/departments/marketing', label: 'Marketing', icon: Megaphone },
  { to: '/departments/support', label: 'Support', icon: Headphones },
  { to: '/departments/strategy', label: 'Strategy', icon: Compass },
  { to: '/departments/development', label: 'Development', icon: Code2 },
];

function NavItem({ to, label, icon: Icon, end, badge }) {
  return (
    <NavLink
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
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 && (
        <span className="text-[10px] font-[var(--font-mono)] font-semibold min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-accent)] text-black flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const tasks = useStore((s) => s.tasks);
  const user = useStore((s) => s.user);
  const signOut = useStore((s) => s.signOut);
  const unreadCount = tasks.filter((t) => !t.read).length;
  const badgeValues = { pendingCount: unreadCount };

  return (
    <aside className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
      <div className="flex items-center gap-2 px-5 h-14 border-b border-[var(--color-border)]">
        <Logo />
        <span className="font-[var(--font-display)] font-semibold tracking-tight text-[15px]">
          CodeCraft
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {appLinks.map(({ to, label, icon, end, badgeKey }) => (
          <NavItem
            key={to}
            to={to}
            label={label}
            icon={icon}
            end={end}
            badge={badgeKey ? badgeValues[badgeKey] : 0}
          />
        ))}

        {/* Departments group */}
        <div className="pt-4 pb-1">
          <NavLink
            to="/departments"
            end
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold transition-colors rounded-md ${
                isActive
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`
            }
          >
            <Building2 size={12} strokeWidth={2} />
            Departments
          </NavLink>
        </div>
        {deptLinks.map(({ to, label, icon }) => (
          <NavItem key={to} to={to} label={label} icon={icon} />
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[11px] text-[var(--color-text-muted)] truncate">{user?.email}</span>
          <button
            onClick={signOut}
            title="Sign out"
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] shrink-0"
          >
            <LogOut size={14} />
          </button>
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)]">
          Build. Automate. Scale.
        </div>
      </div>
    </aside>
  );
}
