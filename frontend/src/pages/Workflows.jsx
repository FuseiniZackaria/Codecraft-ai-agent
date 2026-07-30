import { Workflow } from 'lucide-react';

export default function Workflows() {
  return (
    <div className="p-6 max-w-5xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Workflows</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Chain agents and tools into repeatable automations.
      </p>

      <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-12 flex flex-col items-center text-center gap-3">
        <div className="w-11 h-11 rounded-md bg-[var(--color-accent-dim)] flex items-center justify-center">
          <Workflow size={20} className="text-[var(--color-accent)]" />
        </div>
        <div className="font-[var(--font-display)] font-semibold text-sm">No workflows yet</div>
        <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
          The visual builder isn't wired up in this shell. Workflows will let you chain steps like
          "New lead → Research company → Generate proposal → Email prospect" with branching and retries.
        </p>
      </div>
    </div>
  );
}
