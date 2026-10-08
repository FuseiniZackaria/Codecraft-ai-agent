import { Bot, Clock } from 'lucide-react';

function scheduleLabel(intervalMinutes) {
  if (intervalMinutes <= 0) return null;
  if (intervalMinutes < 60) return `Every ${intervalMinutes}m`;
  if (intervalMinutes % 60 === 0) return `Every ${intervalMinutes / 60}h`;
  return `Every ${Math.floor(intervalMinutes / 60)}h ${intervalMinutes % 60}m`;
}

export default function AgentCard({ agent }) {
  const hasJobs = agent.backgroundJobs?.length > 0;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)]/30 transition-colors flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-[var(--color-accent-dim)] flex items-center justify-center relative shrink-0 mt-0.5">
          <Bot size={17} className="text-[var(--color-accent)]" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--color-success)] pulse-live" />
        </div>
        <div className="min-w-0">
          <div className="font-[var(--font-display)] font-semibold text-sm leading-tight">{agent.role}</div>
          <div className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)] mt-0.5">{agent.key}</div>
        </div>
      </div>

      {/* Description */}
      {agent.description && (
        <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
          {agent.description}
        </p>
      )}

      {/* Goals (kept for extra context when no description) */}
      {!agent.description && (
        <ul className="space-y-1">
          {agent.goals.map((g, i) => (
            <li key={i} className="text-xs text-[var(--color-text-muted)] leading-relaxed">— {g}</li>
          ))}
        </ul>
      )}

      {/* Tool badges */}
      {agent.tools?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {agent.tools.map((t) => (
            <span
              key={t}
              className="text-[10px] font-[var(--font-mono)] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text-muted)]"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Background jobs */}
      {hasJobs && (
        <div className="border-t border-[var(--color-border)] pt-3 space-y-2">
          <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
            Automatic jobs
          </div>
          {agent.backgroundJobs.map((job) => {
            const schedule = scheduleLabel(job.intervalMinutes);
            return (
              <div key={job.name} className="flex items-start gap-2">
                <Clock size={11} className="text-[var(--color-text-muted)] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-[var(--color-text)]">{job.name}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {schedule && (
                      <span className="text-[10px] font-[var(--font-mono)] text-[var(--color-text-muted)]">
                        {schedule}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-[var(--font-mono)] px-1 py-px rounded ${
                        job.enabled
                          ? 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
                          : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'
                      }`}
                    >
                      {job.enabled ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
