// Shared dashboard-style building blocks (CodeCraft look):
//   <PageHeader icon={Gauge} title="Dashboard" subtitle="..." actions={<>...</>} />
//   <Card title="Recent tasks" icon={ListChecks} action={<Link ...>View all</Link>}>...</Card>

export function PageHeader({ icon: Icon, title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
      <div className="min-w-0">
        <h1 className="font-[var(--font-display)] text-2xl font-semibold flex items-center gap-2.5">
          {Icon && (
            <span className="w-9 h-9 rounded-lg bg-[var(--color-brand)] text-white flex items-center justify-center shrink-0">
              <Icon size={18} strokeWidth={2} />
            </span>
          )}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <p className="text-sm text-[var(--color-text-muted)] mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/** Small button for PageHeader actions. variant: 'primary' (navy) | 'accent' (orange) | 'ghost'. */
export function HeaderButton({ as: As = 'button', variant = 'primary', icon: Icon, children, className = '', ...props }) {
  const styles = {
    primary: 'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-2)]',
    accent: 'bg-[var(--color-accent)] text-[var(--color-brand)] hover:brightness-95',
    ghost: 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]',
  }[variant];
  return (
    <As className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${styles} ${className}`} {...props}>
      {Icon && <Icon size={14} />}
      {children}
    </As>
  );
}

export default function Card({ title, icon: Icon, action, children, className = '', bodyClassName = 'p-5' }) {
  return (
    <section className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-sm overflow-hidden flex flex-col ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 py-3 bg-[var(--color-card-header)] border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold flex items-center gap-2 min-w-0">
            {Icon && <Icon size={15} className="text-[var(--color-accent)] shrink-0" />}
            <span className="truncate">{title}</span>
          </h2>
          {action && <div className="shrink-0 text-xs">{action}</div>}
        </div>
      )}
      <div className={`flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
