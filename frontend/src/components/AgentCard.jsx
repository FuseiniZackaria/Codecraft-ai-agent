import { Bot } from 'lucide-react';

export default function AgentCard({ agent }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)]/30 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-md bg-[var(--color-accent-dim)] flex items-center justify-center relative">
          <Bot size={17} className="text-[var(--color-accent)]" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--color-success)] pulse-live" />
        </div>
        <div>
          <div className="font-[var(--font-display)] font-semibold text-sm">{agent.role}</div>
          <div className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)]">{agent.key}</div>
        </div>
      </div>
      <ul className="space-y-1 mb-3">
        {agent.goals.map((g, i) => (
          <li key={i} className="text-xs text-[var(--color-text-muted)] leading-relaxed">— {g}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        {agent.tools.map((t) => (
          <span key={t} className="text-[10px] font-[var(--font-mono)] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
