import { useEffect, useState } from 'react';
import { Gauge, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../../services/api';
import { UsageBar, money, agentLabel } from './UsageBar';

/**
 * "My API usage" - the signed-in admin's OWN estimated spend this month.
 * Fetched when it opens and on Refresh only (no polling).
 */
export default function MyUsageMeter() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setData(await api.getMyUsage());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Gauge size={16} className="text-[var(--color-accent)] shrink-0" />
          <div className="text-sm font-medium truncate">My API usage</div>
          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">estimated</span>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}

      {data && (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="text-2xl font-semibold">{money(data.spentUsd)}</div>
            <div className="text-xs text-[var(--color-text-muted)]">this month · {data.calls} AI call{data.calls === 1 ? '' : 's'}</div>
          </div>
          <UsageBar spent={data.spentUsd} cap={data.capUsd} percent={data.percent} />
          {data.blocked && (
            <div className="flex items-start gap-1.5 text-xs text-[var(--color-danger)]">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              Monthly API credit cap reached. Ask the owner to raise it.
            </div>
          )}
          {data.warning && !data.blocked && (
            <div className="flex items-start gap-1.5 text-xs text-[var(--color-warning)]">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              You have used over 80% of this month's cap ({money(data.remainingUsd)} left).
            </div>
          )}
          {data.byAgent?.length > 0 && (
            <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
              {data.byAgent.map((a) => (
                <div key={a.agent} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs border-b border-[var(--color-border)] last:border-0">
                  <span className="truncate">{agentLabel(a.agent)}</span>
                  <span className="text-[var(--color-text-muted)] shrink-0">{money(a.costUsd)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[var(--color-text-muted)]">Costs are estimates from list prices; your provider's bill is the final word.</p>
        </div>
      )}
    </div>
  );
}
