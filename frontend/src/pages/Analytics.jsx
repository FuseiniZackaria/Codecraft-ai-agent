import { useState, useEffect } from 'react';
import { BarChart3 } from 'lucide-react';
import { api } from '../services/api';
import StatCard from '../components/StatCard';

const RANGES = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

function formatCurrency(n) {
  if (n == null) return '—';
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatPercent(n) {
  if (n == null) return '—';
  return `${Math.round(n * 100)}%`;
}

// A small, dependency-free bar chart - the actual charting need here is
// simple enough (one daily cost series) that pulling in a full charting
// library would be more setup friction than it's worth.
function DailyCostChart({ series }) {
  if (!series.length) {
    return <div className="text-sm text-[var(--color-text-muted)] py-8 text-center">No cost activity in this range yet.</div>;
  }
  const max = Math.max(...series.map((d) => d.cost), 0.0001);
  return (
    <div className="flex items-end gap-1 h-40 pt-4">
      {series.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div
            className="w-full bg-[var(--color-accent)]/70 hover:bg-[var(--color-accent)] rounded-sm transition-colors min-h-[2px]"
            style={{ height: `${Math.max((d.cost / max) * 100, d.cost > 0 ? 2 : 0)}%` }}
            title={`${d.date}: ${formatCurrency(d.cost)}`}
          />
          <div className="absolute -top-6 opacity-0 group-hover:opacity-100 text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1.5 py-0.5 whitespace-nowrap transition-opacity pointer-events-none">
            {d.date}: {formatCurrency(d.cost)}
          </div>
        </div>
      ))}
    </div>
  );
}

function CostByAgentBars({ costByAgent }) {
  const entries = Object.entries(costByAgent).sort(([, a], [, b]) => b - a);
  if (!entries.length) {
    return <div className="text-sm text-[var(--color-text-muted)] py-4 text-center">No LLM activity in this range yet.</div>;
  }
  const max = Math.max(...entries.map(([, v]) => v), 0.0001);
  return (
    <div className="space-y-2.5">
      {entries.map(([agent, cost]) => (
        <div key={agent}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-[var(--color-text)] capitalize">{agent.replace(/-/g, ' ')}</span>
            <span className="text-[var(--color-text-muted)] font-[var(--font-mono)]">{formatCurrency(cost)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
            <div className="h-full bg-[var(--color-accent)] rounded-full" style={{ width: `${(cost / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkflowRunsTable({ runsByWorkflow }) {
  const entries = Object.entries(runsByWorkflow);
  if (!entries.length) {
    return <div className="text-sm text-[var(--color-text-muted)] py-4 text-center">No workflow runs in this range yet.</div>;
  }
  return (
    <div className="space-y-2">
      {entries.map(([name, stats]) => (
        <div key={name} className="flex items-center justify-between px-3 py-2 rounded-md bg-[var(--color-surface-2)]">
          <span className="text-sm truncate">{name}</span>
          <div className="flex items-center gap-3 text-xs shrink-0">
            <span className="text-[var(--color-text-muted)]">{stats.total} run{stats.total === 1 ? '' : 's'}</span>
            {stats.done > 0 && <span className="text-[var(--color-success)]">{stats.done} done</span>}
            {stats.failed > 0 && <span className="text-[var(--color-danger)]">{stats.failed} failed</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const [sinceDays, setSinceDays] = useState(30);
  const [summary, setSummary] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoaded(false);
    setError(null);
    api
      .getAnalyticsSummary(sinceDays)
      .then((data) => {
        setSummary(data);
        setLoaded(true);
      })
      .catch((err) => {
        setError(err.message);
        setLoaded(true);
      });
  }, [sinceDays]);

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <BarChart3 size={20} className="text-[var(--color-accent)]" />
          <h1 className="font-[var(--font-display)] text-xl font-semibold">Analytics</h1>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setSinceDays(r.value)}
              className={`text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
                sinceDays === r.value
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Real cost and execution data, computed from actual API token usage — not an estimate.
      </p>

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-4 text-sm text-[var(--color-danger)] mb-6">
          Couldn't load analytics: {error}
        </div>
      )}

      {!loaded ? null : summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Total cost" value={formatCurrency(summary.totalCost)} accent />
            <StatCard label="LLM calls" value={summary.totalLlmCalls} />
            <StatCard label="Task success rate" value={formatPercent(summary.successRate)} />
            <StatCard label="Avg. task duration" value={formatDuration(summary.avgDurationMs)} />
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4">
            <h2 className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] mb-1">
              Daily cost
            </h2>
            <DailyCostChart series={summary.dailyCostSeries} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] mb-3">
                Cost by agent
              </h2>
              <CostByAgentBars costByAgent={summary.costByAgent} />
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h2 className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] mb-3">
                Workflow runs
              </h2>
              <WorkflowRunsTable runsByWorkflow={summary.runsByWorkflow} />
            </div>
          </div>

          <div className="mt-4 text-[11px] text-[var(--color-text-muted)]">
            {summary.totalInputTokens.toLocaleString()} input tokens · {summary.totalOutputTokens.toLocaleString()} output tokens ·{' '}
            {summary.totalTasks} task{summary.totalTasks === 1 ? '' : 's'} · {summary.totalWorkflowRuns} workflow run
            {summary.totalWorkflowRuns === 1 ? '' : 's'} in the last {summary.sinceDays} days
          </div>
        </>
      )}
    </div>
  );
}
