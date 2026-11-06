import { ListChecks } from 'lucide-react';
import { useOnboarding } from './onboardingStore';
import { ProgressBar } from './SetupChecklist';

/** "Setup · 3 of 6" at the bottom of the sidebar until the checklist is hidden. Opens the checklist. */
export default function SidebarSetupCard({ rail = false, onOpen }) {
  const status = useOnboarding((s) => s.status);
  const open = useOnboarding((s) => s.openChecklist);
  if (!status || status.checklistHidden) return null;
  const click = () => { onOpen?.(); open(); };

  if (rail) {
    return (
      <div className="px-3 pb-2 shrink-0">
        <button
          type="button"
          onClick={click}
          aria-label={`Setup: ${status.doneCount} of ${status.total} done`}
          title={`Setup: ${status.doneCount} of ${status.total} done`}
          className="relative h-10 w-10 mx-auto flex items-center justify-center rounded-md text-[var(--color-accent)] hover:bg-white/70"
        >
          <ListChecks size={16} strokeWidth={1.75} />
          <span className="absolute -top-0.5 -right-0.5 text-[9px] font-semibold rounded-full bg-[var(--color-accent)] text-black px-1">{status.doneCount}/{status.total}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 pb-2 shrink-0">
      <button
        type="button"
        onClick={click}
        className="w-full text-left rounded-lg border border-[var(--color-accent)]/40 bg-white hover:border-[var(--color-accent)] p-3 transition-colors"
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-[var(--color-text)]"><ListChecks size={14} className="text-[var(--color-accent)]" /> Setup</span>
          <span className="text-[var(--color-text-muted)]">{status.doneCount} of {status.total} done</span>
        </div>
        <ProgressBar done={status.doneCount} total={status.total} className="mt-2" />
        <div className="text-[11px] text-[var(--color-text-muted)] mt-1.5">
          {status.complete ? 'All set - open to hide this.' : 'Continue setting up →'}
        </div>
      </button>
    </div>
  );
}
