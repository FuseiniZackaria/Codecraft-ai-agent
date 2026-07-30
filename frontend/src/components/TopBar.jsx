import { Search, Circle } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function TopBar() {
  const { connected, setPaletteOpen } = useStore();

  return (
    <header className="h-14 border-b border-[var(--color-border)] flex items-center justify-between px-6 bg-[var(--color-bg)]/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Circle
          size={8}
          className={connected ? 'text-[var(--color-success)] fill-current pulse-live rounded-full' : 'text-[var(--color-warning)] fill-current'}
        />
        {connected ? 'Connected to backend' : 'Demo mode — backend not reachable'}
      </div>

      <button
        onClick={() => setPaletteOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40 transition-colors"
      >
        <Search size={14} />
        <span>Quick action</span>
        <kbd className="ml-2 text-[10px] font-[var(--font-mono)] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)]">
          ⌘K
        </kbd>
      </button>
    </header>
  );
}
