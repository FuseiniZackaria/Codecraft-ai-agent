import { NavLink } from 'react-router-dom';

/**
 * Tab bar for the tabbed parent pages (Home, Chat, Work, Toolbox, Settings).
 * Each tab is a real route, so tabs can be linked to and the back button
 * works. Looks the same at every screen size; on narrow screens it scrolls
 * sideways instead of wrapping.
 *
 * @param {{label: string, to: string, end?: boolean, badgeKey?: string}[]} tabs
 * @param {'underline'|'segmented'} variant - segmented = pill toggle (Chat | Console)
 * @param {Record<string, number>} badges - live counts by badgeKey
 */
export default function PageTabs({ tabs, variant = 'underline', badges = {} }) {
  const segmented = variant === 'segmented';
  return (
    <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <nav
        aria-label="Page sections"
        className={
          segmented
            ? 'inline-flex gap-0.5 p-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]'
            : 'flex gap-1 border-b border-[var(--color-border)] min-w-max'
        }
      >
        {tabs.map((tab) => {
          const badge = tab.badgeKey ? badges[tab.badgeKey] || 0 : 0;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                segmented
                  ? `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-[var(--color-surface-2)] text-[var(--color-text)] shadow-sm'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    }`
                  : `flex items-center gap-1.5 px-3 py-2 -mb-px text-sm whitespace-nowrap border-b-2 transition-colors ${
                      isActive
                        ? 'border-[var(--color-accent)] text-[var(--color-text)]'
                        : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    }`
              }
            >
              {tab.label}
              {badge > 0 && (
                <span className="text-[10px] font-[var(--font-mono)] font-semibold min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-accent)] text-black flex items-center justify-center">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
