import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, AlertTriangle, MinusCircle } from 'lucide-react';

/* ---------------------------------------------------------------------------
 * Coloured stat card: icon + label, big number, "More info" footer.
 * Colours are dark enough for white text; the orange card uses navy text.
 * ------------------------------------------------------------------------- */
const KPI_TONES = {
  navy: { bg: 'var(--color-brand)', fg: '#ffffff' },
  green: { bg: 'var(--color-stat-green)', fg: '#ffffff' },
  orange: { bg: 'var(--color-accent)', fg: 'var(--color-brand)' },
  red: { bg: 'var(--color-stat-red)', fg: '#ffffff' },
};

export function KpiCard({ tone = 'navy', icon: Icon, label, shortLabel, value, to, linkLabel = 'More info' }) {
  const t = KPI_TONES[tone];
  return (
    <div className="rounded-lg shadow-sm overflow-hidden flex flex-col" style={{ background: t.bg, color: t.fg }}>
      <div className="px-4 pt-3.5 flex items-center gap-2 text-sm font-medium opacity-95">
        {Icon && <Icon size={16} />}
        {shortLabel ? (
          <>
            <span className="truncate sm:hidden">{shortLabel}</span>
            <span className="truncate hidden sm:inline">{label}</span>
          </>
        ) : <span className="truncate">{label}</span>}
      </div>
      <div className="px-4 pt-2 pb-4 font-[var(--font-display)] text-3xl sm:text-4xl font-semibold leading-none">{value}</div>
      {to && (
        <Link to={to} className="mt-auto px-4 py-2 text-xs font-medium flex items-center justify-end gap-1.5 bg-black/15 hover:bg-black/25 transition-colors" style={{ color: t.fg }}>
          {linkLabel} <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Task status: one segmented bar (part of a whole), status colours with an
 * icon + label + count, so colour is never the only cue. Hover a segment.
 * ------------------------------------------------------------------------- */
const STATUS = [
  { key: 'done', label: 'Done', color: '#10b981', icon: CheckCircle2 },
  { key: 'pending_approval', label: 'Waiting for you', color: '#f59e0b', icon: Clock },
  { key: 'failed', label: 'Failed', color: '#ef4444', icon: AlertTriangle },
  { key: 'other', label: 'Other', hint: 'pending or rejected', color: '#9ca3af', icon: MinusCircle },
];

export function TaskStatusBar({ counts }) {
  const [hover, setHover] = useState(null);
  const total = counts?.total || 0;
  const parts = STATUS.map((s) => {
    const value = s.key === 'other'
      ? Math.max(0, total - (counts.done || 0) - (counts.pending_approval || 0) - (counts.failed || 0))
      : counts?.[s.key] || 0;
    return { ...s, value, pct: total ? Math.round((value / total) * 100) : 0 };
  });
  const shown = parts.filter((p) => p.value > 0);

  if (!total) return <div className="text-sm text-[var(--color-text-muted)] py-6 text-center">No tasks yet.</div>;

  return (
    <div>
      <div className="text-xs text-[var(--color-text-muted)] mb-2">{total.toLocaleString()} tasks in total</div>
      <div className="relative">
        <div className="flex h-7 gap-[2px]" role="img" aria-label={shown.map((p) => `${p.label}: ${p.value}`).join(', ')}>
          {shown.map((p, i) => (
            <div
              key={p.key}
              onMouseEnter={() => setHover(p.key)}
              onMouseLeave={() => setHover(null)}
              className={`h-full transition-opacity ${i === 0 ? 'rounded-l' : ''} ${i === shown.length - 1 ? 'rounded-r' : ''} ${hover && hover !== p.key ? 'opacity-50' : ''}`}
              style={{ width: `${(p.value / total) * 100}%`, minWidth: 6, background: p.color }}
            />
          ))}
        </div>
        {hover && (() => {
          const p = parts.find((x) => x.key === hover);
          return (
            <div className="absolute -top-9 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-[var(--color-brand)] text-white text-xs whitespace-nowrap shadow-lg pointer-events-none">
              {p.label}: <span className="font-semibold">{p.value}</span> ({p.pct}%)
            </div>
          );
        })()}
      </div>
      <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {parts.map((p) => {
          const Icon = p.icon;
          return (
            <li key={p.key} className="flex items-center gap-2 text-sm">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: p.color }} aria-hidden="true" />
              <Icon size={14} className="text-[var(--color-text-muted)] shrink-0" />
              <span className="flex-1 truncate" title={p.hint}>{p.label}</span>
              <span className="font-semibold tabular-nums">{p.value}</span>
              <span className="text-xs text-[var(--color-text-muted)] w-9 text-right tabular-nums">{p.pct}%</span>
            </li>
          );
        })}
      </ul>
      {(counts.done || counts.failed) ? (
        <div className="mt-5 pt-4 border-t border-[var(--color-border)] flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Success rate</div>
            <div className="text-[11px] text-[var(--color-text-muted)]">done out of finished (done + failed)</div>
          </div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tabular-nums">
            {Math.round(((counts.done || 0) / ((counts.done || 0) + (counts.failed || 0))) * 100)}%
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Tasks per day, last 7 days: one series (orange columns, value on the cap,
 * hairline grid, hover tooltip). Single series = no legend; the title names it.
 * ------------------------------------------------------------------------- */
function niceMax(n) {
  if (n <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= n) return m * step;
  return 10 * step;
}

export function TasksPerDayChart({ tasks }) {
  const [hover, setHover] = useState(null);
  const days = useMemo(() => {
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      out.push({ date: d, count: 0 });
    }
    for (const t of tasks || []) {
      const at = new Date(t.created_at || t.createdAt || 0);
      at.setHours(0, 0, 0, 0);
      const slot = out.find((x) => x.date.getTime() === at.getTime());
      if (slot) slot.count += 1;
    }
    return out;
  }, [tasks]);

  const max = niceMax(Math.max(...days.map((d) => d.count), 1));
  const ticks = [0, max / 2, max];
  const total = days.reduce((n, d) => n + d.count, 0);

  return (
    <div>
      <div className="text-xs text-[var(--color-text-muted)] mb-3">{total} task{total === 1 ? '' : 's'} created in the last 7 days</div>
      <div className="relative h-44 pl-8">
        {/* gridlines + y labels */}
        {ticks.map((t) => (
          <div key={t} className="absolute left-8 right-0 border-t border-[var(--color-border)]" style={{ bottom: `${(t / max) * 100}%` }}>
            <span className="absolute -left-8 -translate-y-1/2 w-6 text-right text-[10px] text-[var(--color-text-muted)] tabular-nums">{t}</span>
          </div>
        ))}
        <div className="absolute inset-0 left-8 flex items-end justify-around">
          {days.map((d, i) => {
            const h = (d.count / max) * 100;
            const label = d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
            return (
              <div
                key={i}
                className="relative h-full flex-1 flex flex-col items-center justify-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                aria-label={`${label}: ${d.count} tasks`}
              >
                {d.count > 0 && <span className="text-[10px] font-semibold tabular-nums mb-0.5">{d.count}</span>}
                <div
                  className={`w-full max-w-[24px] rounded-t transition-opacity ${hover !== null && hover !== i ? 'opacity-50' : ''}`}
                  style={{ height: `${h}%`, minHeight: d.count ? 3 : 0, background: 'var(--color-accent)' }}
                />
                {hover === i && (
                  <div className="absolute bottom-full mb-1 px-2.5 py-1 rounded-md bg-[var(--color-brand)] text-white text-xs whitespace-nowrap shadow-lg pointer-events-none z-10">
                    {label}: <span className="font-semibold">{d.count}</span> task{d.count === 1 ? '' : 's'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-around pl-8 mt-1.5">
        {days.map((d, i) => (
          <span key={i} className={`flex-1 text-center text-[10px] ${i === 6 ? 'font-semibold text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>
            {i === 6 ? 'Today' : d.date.toLocaleDateString(undefined, { weekday: 'short' })}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Recent tasks table with a navy header row.
 * ------------------------------------------------------------------------- */
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function RecentTasksTable({ tasks, StatusPill }) {
  const rows = [...(tasks || [])]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 6);
  if (!rows.length) return <div className="text-sm text-[var(--color-text-muted)] p-5 text-center">No tasks yet - ask Ian in Chat to get started.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--color-brand)] text-white text-left">
            <th className="px-4 py-2.5 font-semibold">Task</th>
            <th className="px-4 py-2.5 font-semibold hidden sm:table-cell">Agent</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
            <th className="px-4 py-2.5 font-semibold text-right hidden md:table-cell">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={t.id} className={`border-b border-[var(--color-border)] last:border-0 ${i % 2 ? 'bg-[var(--color-surface-2)]/50' : ''}`}>
              <td className="px-4 py-2.5 max-w-[280px]"><div className="truncate" title={t.instruction}>{t.instruction || '(no description)'}</div></td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)] capitalize hidden sm:table-cell">{String(t.agent || '-').replace(/-/g, ' ')}</td>
              <td className="px-4 py-2.5"><StatusPill status={t.status} /></td>
              <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)] whitespace-nowrap hidden md:table-cell">{t.created_at ? ago(t.created_at) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2.5 text-right border-t border-[var(--color-border)]">
        <Link to="/work" className="text-xs font-medium text-[var(--color-accent)] hover:underline inline-flex items-center gap-1">All tasks <ArrowRight size={12} /></Link>
      </div>
    </div>
  );
}
