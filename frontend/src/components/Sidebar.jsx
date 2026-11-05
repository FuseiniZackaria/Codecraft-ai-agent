import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import Logo from './Logo';
import { useStore } from '../store/useStore';
import { NAV_ITEMS } from './nav/navConfig';
import { useNavBadges } from './nav/useNavBadges';

// Same 6 items (navConfig) in three layouts:
//   desktop/laptop (>=1024px): sidebar, collapsible to an icon rail (remembered)
//   tablet (768-1023px): icon rail, expands over the page on tap
//   phone (<768px): slide-out drawer, opened from the TopBar menu button
const COLLAPSED_KEY = 'cc_nav_collapsed';
const DEPTS_OPEN_KEY = 'cc_nav_departments_open';

function readFlag(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* storage unavailable (private mode, quota) - the state just won't persist */
  }
}

function currentMode() {
  if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'phone';
}

function useNavMode() {
  const [mode, setMode] = useState(currentMode);
  useEffect(() => {
    const queries = ['(min-width: 1024px)', '(min-width: 768px)'].map((q) => window.matchMedia(q));
    const onChange = () => setMode(currentMode());
    queries.forEach((q) => q.addEventListener('change', onChange));
    return () => queries.forEach((q) => q.removeEventListener('change', onChange));
  }, []);
  return mode;
}

/** Hover label for icon-only rail items. */
function RailTooltip({ label }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded-md text-xs whitespace-nowrap
        bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] shadow-lg
        opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity z-50"
    >
      {label}
    </span>
  );
}

function Badge({ count, rail }) {
  if (!count) return null;
  if (rail) {
    return <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--color-accent)]" aria-label={`${count} unread`} />;
  }
  return (
    <span className="text-[10px] font-[var(--font-mono)] font-semibold min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-accent)] text-black flex items-center justify-center">
      {count > 9 ? '9+' : count}
    </span>
  );
}

const itemClass = (active, rail) =>
  `group relative flex items-center gap-2.5 rounded-md text-sm transition-colors ${
    rail ? 'justify-center h-10 w-10 mx-auto' : 'px-3 py-2.5 md:py-2'
  } ${
    active
      ? 'bg-white text-[var(--color-text)] font-medium shadow-sm before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r before:bg-[var(--color-accent)] [&>svg]:text-[var(--color-accent)]'
      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/70'
  }`;

/** Grey section heading ("Main navigation"), or a thin divider in the icon rail. */
function GroupHeading({ label, rail, first }) {
  if (rail) return first ? null : <div className="my-2 mx-3 border-t border-[var(--color-border)]" aria-hidden="true" />;
  return (
    <div className={`${first ? '' : 'mt-4'} mb-1.5 px-3 py-1.5 rounded-md bg-[var(--color-sidebar-heading)] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]`}>
      {label}
    </div>
  );
}

export default function Sidebar({ isOpen = false, onClose }) {
  const user = useStore((s) => s.user);
  const signOut = useStore((s) => s.signOut);
  const badges = useNavBadges();
  const { pathname } = useLocation();
  const mode = useNavMode();

  const [collapsed, setCollapsed] = useState(() => readFlag(COLLAPSED_KEY, false));
  const [tabletExpanded, setTabletExpanded] = useState(false);
  const [deptsOpen, setDeptsOpen] = useState(() => readFlag(DEPTS_OPEN_KEY, false));

  const onDepartmentPage = pathname.startsWith('/departments');
  const rail = (mode === 'tablet' && !tabletExpanded) || (mode === 'desktop' && collapsed);

  // Auto-expand Departments when a department page is open.
  useEffect(() => {
    if (onDepartmentPage && !deptsOpen) {
      setDeptsOpen(true);
      writeFlag(DEPTS_OPEN_KEY, true);
    }
  }, [onDepartmentPage]);

  // The tablet overlay closes on navigation.
  useEffect(() => {
    setTabletExpanded(false);
  }, [pathname]);

  function toggleDepts() {
    setDeptsOpen((open) => {
      writeFlag(DEPTS_OPEN_KEY, !open);
      return !open;
    });
  }

  function setRail(nextRail) {
    if (mode === 'tablet') setTabletExpanded(!nextRail);
    else {
      setCollapsed(nextRail);
      writeFlag(COLLAPSED_KEY, nextRail);
    }
  }

  // In the rail, Departments has nowhere to show its children: open the full sidebar with the group expanded.
  function onDepartmentsRailClick() {
    setDeptsOpen(true);
    writeFlag(DEPTS_OPEN_KEY, true);
    setRail(false);
  }

  const closeAll = () => {
    onClose?.();
  };

  const asideClass = {
    phone: `fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`,
    tablet: `fixed inset-y-0 left-0 z-50 transition-[width] duration-200 ${rail ? 'w-16' : 'w-64 shadow-2xl'}`,
    desktop: `relative z-30 shrink-0 transition-[width] duration-200 ${rail ? 'w-16' : 'w-56'}`,
  }[mode];

  const showBackdrop = (mode === 'phone' && isOpen) || (mode === 'tablet' && tabletExpanded);

  return (
    <>
      {/* Keeps the page clear of the fixed tablet rail. */}
      {mode === 'tablet' && <div className="w-16 shrink-0" aria-hidden="true" />}

      <div
        aria-hidden="true"
        onClick={() => (mode === 'tablet' ? setTabletExpanded(false) : closeAll())}
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          showBackdrop ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      <aside className={`${asideClass} h-dvh border-r border-[var(--color-border)] bg-[var(--color-sidebar)] flex flex-col`}>
        <div className={`flex items-center gap-2 h-14 shrink-0 bg-[var(--color-brand)] text-white ${rail ? 'justify-center' : 'px-5'}`}>
          <Logo onDark />
          {!rail && (
            <span className="font-[var(--font-display)] font-semibold tracking-tight text-[15px] flex-1 truncate">CodeCraft</span>
          )}
          {mode === 'phone' && (
            <button
              type="button"
              onClick={closeAll}
              aria-label="Close navigation"
              className="p-1.5 -mr-1 rounded-md text-white/80 hover:text-white hover:bg-white/10"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <nav className={`flex-1 px-3 py-3 space-y-0.5 ${rail ? 'overflow-visible' : 'overflow-y-auto'}`} aria-label="Main">
          {NAV_ITEMS.map((item, index) => {
            const Icon = item.icon;
            const badge = item.badgeKey ? badges[item.badgeKey] || 0 : 0;
            const heading = item.group && item.group !== NAV_ITEMS[index - 1]?.group
              ? <GroupHeading label={item.group} rail={rail} first={index === 0} />
              : null;

            if (item.children) {
              return (
                <div key={item.key}>
                  {heading}
                  <button
                    type="button"
                    onClick={rail ? onDepartmentsRailClick : toggleDepts}
                    aria-expanded={rail ? undefined : deptsOpen}
                    aria-label={rail ? item.label : undefined}
                    className={`${itemClass(onDepartmentPage, rail)} w-full`}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    {rail ? (
                      <RailTooltip label={item.label} />
                    ) : (
                      <>
                        <span className="flex-1 truncate text-left">{item.label}</span>
                        <ChevronDown
                          size={14}
                          className={`text-[var(--color-text-muted)] transition-transform ${deptsOpen ? '' : '-rotate-90'}`}
                        />
                      </>
                    )}
                  </button>
                  {!rail && deptsOpen && (
                    <div className="mt-0.5 ml-4 pl-2 border-l border-[var(--color-border)] space-y-0.5">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        return (
                          <NavLink
                            key={child.to}
                            to={child.to}
                            onClick={closeAll}
                            className={({ isActive }) => `${itemClass(isActive, false)} !py-1.5`}
                          >
                            <ChildIcon size={15} strokeWidth={1.75} />
                            <span className="flex-1 truncate">{child.label}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={item.key}>
                {heading}
                <NavLink
                  to={item.to}
                  onClick={closeAll}
                  aria-label={rail ? item.label : undefined}
                  className={({ isActive }) => itemClass(isActive, rail)}
                >
                  <Icon size={16} strokeWidth={1.75} />
                  {rail ? <RailTooltip label={item.label} /> : <span className="flex-1 truncate">{item.label}</span>}
                  <Badge count={badge} rail={rail} />
                </NavLink>
              </div>
            );
          })}
        </nav>

        {mode !== 'phone' && (
          <div className="px-3 pb-2 shrink-0">
            <button
              type="button"
              onClick={() => setRail(!rail)}
              aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
              className={itemClass(false, rail) + (rail ? '' : ' w-full')}
            >
              {rail ? <PanelLeftOpen size={16} strokeWidth={1.75} /> : <PanelLeftClose size={16} strokeWidth={1.75} />}
              {rail ? <RailTooltip label="Expand sidebar" /> : <span className="flex-1 truncate text-left">Collapse</span>}
            </button>
          </div>
        )}

        {rail ? (
          <div className="py-3 border-t border-[var(--color-border)] shrink-0">
            <button type="button" onClick={signOut} aria-label="Sign out" className={`${itemClass(false, true)} hover:!text-[var(--color-danger)]`}>
              <LogOut size={15} />
              <RailTooltip label={`Sign out${user?.email ? ` (${user.email})` : ''}`} />
            </button>
          </div>
        ) : (
          <div className="px-3 py-3 border-t border-[var(--color-border)] shrink-0">
            <GroupHeading label="Account" first />
            <div className="flex items-center justify-between gap-2 mb-2 px-2">
              <span className="text-[11px] text-[var(--color-text-muted)] truncate">{user?.email}</span>
              <button
                onClick={signOut}
                title="Sign out"
                className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] shrink-0"
              >
                <LogOut size={14} />
              </button>
            </div>
            <div className="px-2 text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)]">Build. Automate. Scale.</div>
          </div>
        )}
      </aside>
    </>
  );
}
