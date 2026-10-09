import { Search, Circle, Menu } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function TopBar({ onOpenSidebar }) {
  const { connected, setPaletteOpen } = useStore();

  return (
    <header className="h-14 border-b border-[var(--color-border)] flex items-center justify-between gap-2 px-3 sm:px-6 bg-[var(--color-bg)]/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="flex items-center gap-2 min-w-0">
        {onOpenSidebar && (
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open navigation"
            className="md:hidden p-2 -ml-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          >
            <Menu size={18} />
          </button>
        )}
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] min-w-0">
          <Circle
            size={8}
            className={`shrink-0 ${connected ? 'text-[var(--color-success)] fill-current pulse-live rounded-full' : 'text-[var(--color-warning)] fill-current'}`}
          />
          {/* Full label from sm up; status dot alone on phones (title still
              carries the full message for a long-press/tooltip). */}
          <span
            className="hidden sm:inline truncate"
            title={connected ? 'Connected to backend' : 'Demo mode — backend not reachable'}
          >
            {connected ? 'Connected to backend' : 'Demo mode — backend not reachable'}
          </span>
          <span className="sr-only sm:hidden">
            {connected ? 'Connected to backend' : 'Demo mode — backend not reachable'}
          </span>
        </div>
      </div>

      <button
        onClick={() => setPaletteOpen(true)}
        className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40 transition-colors shrink-0"
        aria-label="Quick action"
      >
        <Search size={14} />
        <span className="hidden sm:inline">Quick action</span>
        <kbd className="hidden sm:inline ml-2 text-[10px] font-[var(--font-mono)] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)]">
          ⌘K
        </kbd>
      </button>
    </header>
  );
}
