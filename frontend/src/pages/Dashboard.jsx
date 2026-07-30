import { useStore } from '../store/useStore';
import StatCard from '../components/StatCard';
import StatusPill from '../components/StatusPill';

function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function Dashboard() {
  const { summary, tasks } = useStore();
  const pending = tasks.filter((t) => t.status === 'pending_approval');

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Overview</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">Your autonomous workforce, at a glance.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="Active agents" value={summary.activeAgents} />
        <StatCard label="Tasks done" value={summary.tasks.done} />
        <StatCard label="Awaiting approval" value={summary.tasks.pending_approval} accent={summary.tasks.pending_approval > 0} />
        <StatCard label="Failed" value={summary.tasks.failed} />
      </div>

      {pending.length > 0 && (
        <div className="mb-8 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4">
          <div className="text-sm font-medium mb-1 text-[var(--color-warning)]">
            {pending.length} action{pending.length > 1 ? 's' : ''} waiting on you
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            Irreversible actions pause here until approved. Review them on the Tasks page.
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3">Activity</h2>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <ol className="relative border-l border-[var(--color-border)] ml-1 space-y-4">
              {summary.auditLog.slice().reverse().map((e, i) => (
                <li key={i} className="pl-4 relative">
                  <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                  <div className="text-sm">
                    <span className="text-[var(--color-text-muted)]">{e.actor}</span>{' '}
                    <span className="font-[var(--font-mono)] text-[13px]">{e.action}</span>{' '}
                    {e.target && <span className="text-[var(--color-text-muted)]">→ {e.target}</span>}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)]">{timeAgo(e.at)}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3">Installed tools</h2>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-wrap gap-2">
            {summary.installedTools.map((t) => (
              <span key={t} className="text-xs font-[var(--font-mono)] px-2 py-1 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                {t}
              </span>
            ))}
          </div>

          <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3 mt-5">Model providers</h2>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-wrap gap-2">
            {summary.availableProviders.map((p) => (
              <StatusPill key={p} status={p === 'mock' ? 'pending' : 'done'} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
