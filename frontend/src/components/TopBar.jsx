import { Search, Menu } from 'lucide-react';
import { useStore } from '../store/useStore';
import Logo from './Logo';
import HelpMenu from './onboarding/HelpMenu';

/**
 * The navy brand bar across the top of every page: (phone) menu + logo,
 * connection status, Quick action, and who's signed in.
 */
export default function TopBar({ onOpenSidebar }) {
  const { connected, setPaletteOpen } = useStore();
  const user = useStore((s) => s.user);
  const initial = (user?.email || '?').trim().charAt(0).toUpperCase();
  const status = connected ? 'Connected' : 'Demo mode - backend not reachable';

  return (
    <header className="h-14 shrink-0 flex items-center justify-between gap-2 px-3 sm:px-6 bg-[var(--color-brand)] text-white sticky top-0 z-10 shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        {onOpenSidebar && (
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open navigation"
            data-tour="menu"
            className="md:hidden p-2 -ml-1 rounded-md text-white/80 hover:text-white hover:bg-white/10"
          >
            <Menu size={18} />
          </button>
        )}
        {/* On phones the sidebar is hidden, so the brand shows here. */}
        <div className="md:hidden flex items-center gap-2">
          <Logo onDark />
          <span className="font-[var(--font-display)] font-semibold tracking-tight">CodeCraft</span>
        </div>
        <span
          className="hidden md:inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-white/10 text-white/85"
          title={connected ? 'Connected to the backend' : 'Demo mode - backend not reachable'}
        >
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          {status}
        </span>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <span className="md:hidden w-2 h-2 rounded-full shrink-0" title={status} style={{ background: connected ? '#34d399' : '#fbbf24' }}>
          <span className="sr-only">{status}</span>
        </span>
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-md bg-white/10 text-sm text-white/85 hover:bg-white/15 hover:text-white transition-colors"
          aria-label="Quick action"
        >
          <Search size={14} />
          <span className="hidden sm:inline">Quick action</span>
          <kbd className="hidden sm:inline ml-1 text-[10px] font-[var(--font-mono)] px-1.5 py-0.5 rounded bg-white/10">⌘K</kbd>
        </button>
        <HelpMenu />
        {user && (
          <div className="flex items-center gap-2 min-w-0" title={user.email}>
            <span className="w-8 h-8 rounded-full bg-[var(--color-accent)] text-[var(--color-brand)] font-semibold text-sm flex items-center justify-center shrink-0">
              {initial}
            </span>
            <span className="hidden lg:inline text-sm text-white/85 truncate max-w-[180px]">{user.email}</span>
          </div>
        )}
      </div>
    </header>
  );
}
