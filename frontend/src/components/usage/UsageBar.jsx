/** Shared bits for the API usage views (estimated cost, USD). */

export function money(n) {
  const v = Number(n || 0);
  if (v === 0) return '$0.00';
  if (v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}

export function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!y || !m) return ym || '';
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' });
}

export function agentLabel(a) {
  if (!a || a === 'other') return 'Other';
  if (a === 'assistant') return 'Chat assistant';
  return a.charAt(0).toUpperCase() + a.slice(1);
}

/** Spend against the cap: green, amber from 80%, red at the cap. No cap = a plain note. */
export function UsageBar({ spent, cap, percent }) {
  if (cap === null || cap === undefined) {
    return <div className="text-[11px] text-[var(--color-text-muted)]">No monthly cap</div>;
  }
  const pct = Math.min(100, Math.max(0, Number(percent || 0)));
  const color = pct >= 100 ? 'var(--color-danger)' : pct >= 80 ? 'var(--color-warning)' : 'var(--color-success)';
  return (
    <div>
      <div className="h-2 w-full rounded-full bg-[var(--color-bg)] border border-[var(--color-border)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
        {money(spent)} of {money(cap)} ({Math.round(Number(percent || 0))}%)
      </div>
    </div>
  );
}
