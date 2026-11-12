import { useEffect, useState } from 'react';
import { Gauge, RefreshCw, ChevronDown, ChevronRight, Bot } from 'lucide-react';
import { api } from '../../services/api';
import { UsageBar, money, monthLabel, agentLabel } from './UsageBar';

/** Set or clear one person's (or the automated bucket's) monthly cap. */
function CapForm({ row, onSaved }) {
  const [value, setValue] = useState(row.capUsd === null || row.capUsd === undefined ? '' : String(row.capUsd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputId = `cap-${row.userId}`;

  async function save(cap) {
    setBusy(true);
    setError(null);
    try {
      await api.setUsageCap(row.userId, cap);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed === '') return save(null);
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      setError('Enter an amount in USD, e.g. 20, or leave it empty for no cap.');
      return;
    }
    save(n);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-1">
      <label htmlFor={inputId} className="text-xs text-[var(--color-text-muted)] block">Monthly cap (USD)</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="No cap"
          className="w-32 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-base md:text-sm outline-none focus:border-[var(--color-accent)]/50"
        />
        <button
          type="submit"
          disabled={busy}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Saving...' : 'Save cap'}
        </button>
        {row.capUsd !== null && row.capUsd !== undefined && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { setValue(''); save(null); }}
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            Remove cap
          </button>
        )}
      </div>
      {error && <div className="text-[11px] text-[var(--color-danger)]">{error}</div>}
    </form>
  );
}

function SixMonths({ months }) {
  const max = Math.max(0.0001, ...months.map((m) => m.costUsd));
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Last 6 months</div>
      <div className="grid grid-cols-6 gap-1 items-end h-16">
        {months.map((m) => (
          <div key={m.month} className="flex flex-col items-center justify-end h-full min-w-0" title={`${m.month}: ${money(m.costUsd)}`}>
            <div className="w-full rounded-sm bg-[var(--color-accent)]/60" style={{ height: `${Math.max(2, (m.costUsd / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1 mt-1">
        {months.map((m) => (
          <div key={m.month} className="text-center min-w-0">
            <div className="text-[10px] text-[var(--color-text-muted)] truncate">{monthLabel(m.month)}</div>
            <div className="text-[10px] truncate">{money(m.costUsd)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsageRow({ row, title, badge, icon, onSaved }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--color-border)] last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-3 flex flex-col gap-2 hover:bg-[var(--color-bg)]/50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0 w-full">
          {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
          {icon}
          <span className="text-sm font-medium break-all min-w-0 flex-1">{title}</span>
          {badge}
          <span className="text-sm font-semibold shrink-0">{money(row.spentUsd)}</span>
        </div>
        <div className="pl-5 w-full">
          <UsageBar spent={row.spentUsd} cap={row.capUsd} percent={row.percent} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pl-9 space-y-3">
          {row.byAgent.length > 0 ? (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">This month by agent</div>
              <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
                {row.byAgent.map((a) => (
                  <div key={a.agent} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs border-b border-[var(--color-border)] last:border-0">
                    <span className="truncate">{agentLabel(a.agent)}</span>
                    <span className="text-[var(--color-text-muted)] shrink-0">{a.calls} call{a.calls === 1 ? '' : 's'} · {money(a.costUsd)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-[var(--color-text-muted)]">No AI calls this month.</div>
          )}
          <SixMonths months={row.months} />
          <CapForm row={row} onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}

/**
 * Owner only (Team page): every admin's estimated API spend this month, cap,
 * per-agent breakdown, last 6 months, and the "Automated" bucket (scheduler,
 * webhooks). Fetched on open and on Refresh - no polling.
 */
export default function TeamUsagePanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setData(await api.getUsage());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  const roleBadge = (role) => role === 'owner' || role === 'former' ? (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] shrink-0">
      {role === 'owner' ? 'owner' : 'removed'}
    </span>
  ) : null;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] mb-4">
      <div className="flex items-center justify-between gap-2 p-4 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Gauge size={16} className="text-[var(--color-accent)] shrink-0" />
          <div className="text-sm font-medium truncate">API usage</div>
          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">estimated</span>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
          {busy ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      <p className="px-4 text-xs text-[var(--color-text-muted)] mb-2">
        This month (UTC), from list prices. Admins at their cap can't run AI work until you raise it. Only you can see this.
      </p>

      {error && <div className="px-4 pb-3 text-xs text-[var(--color-danger)]">{error}</div>}

      {data && (
        <>
          <div className="px-4 pb-3 flex items-baseline gap-2 flex-wrap">
            <div className="text-2xl font-semibold">{money(data.totalUsd)}</div>
            <div className="text-xs text-[var(--color-text-muted)]">total this month</div>
          </div>
          <div className="border-t border-[var(--color-border)]">
            {data.admins.map((a) => (
              <UsageRow key={a.userId} row={a} title={a.email || a.userId} badge={roleBadge(a.role)} onSaved={load} />
            ))}
            <UsageRow
              row={data.automated}
              title={data.automated.label}
              icon={<Bot size={14} className="text-[var(--color-text-muted)] shrink-0" />}
              onSaved={load}
            />
          </div>
        </>
      )}
    </div>
  );
}
