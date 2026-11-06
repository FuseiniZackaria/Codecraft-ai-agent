import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight, Clock, Undo2, X, Compass } from 'lucide-react';
import { useOnboarding } from './onboardingStore';

export function ProgressBar({ done, total, className = '' }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={`h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden ${className}`} role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
      <div className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The 6 setup steps with a progress bar. Each step links to its page, ticks
 * itself off when done, and can be skipped for now (and brought back).
 * onNavigate: called when a step's link is followed (e.g. to close a panel).
 */
export default function SetupChecklist({ onNavigate, showTitle = true }) {
  const status = useOnboarding((s) => s.status);
  const skip = useOnboarding((s) => s.skip);
  const hide = useOnboarding((s) => s.hide);
  const startTour = useOnboarding((s) => s.startTour);
  if (!status) return null;
  const next = status.steps.find((s) => !s.done && !s.skipped && !s.unavailable);

  return (
    <div className="space-y-3">
      {showTitle && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold font-[var(--font-display)]">Set up your workspace</div>
            <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{status.doneCount} of {status.total} done</span>
          </div>
          <ProgressBar done={status.doneCount} total={status.total} className="mt-2" />
        </div>
      )}

      <ol className="space-y-1.5">
        {status.steps.map((step, i) => {
          const isNext = next?.key === step.key;
          return (
            <li
              key={step.key}
              className={`rounded-md border p-2.5 ${isNext ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/5' : 'border-[var(--color-border)]'}`}
            >
              <div className="flex items-start gap-2.5">
                {step.done
                  ? <CheckCircle2 size={17} className="text-emerald-600 shrink-0 mt-0.5" />
                  : step.unavailable || step.skipped
                    ? <Clock size={17} className="text-[var(--color-text-muted)] shrink-0 mt-0.5" />
                    : <Circle size={17} className="text-[var(--color-text-muted)] shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${step.done ? 'line-through text-[var(--color-text-muted)]' : 'font-medium'}`}>
                    {i + 1}. {step.label}
                  </div>
                  {!step.done && (
                    <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {step.unavailable
                        ? "Not available for your workspace yet - right now only one WhatsApp number can be linked. We'll let you know when you can connect yours."
                        : step.skipped ? 'Skipped for now.' : step.description}
                    </div>
                  )}
                  {!step.done && !step.unavailable && (
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <Link
                        to={step.to}
                        onClick={onNavigate}
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md ${isNext ? 'bg-[var(--color-accent)] text-black' : 'border border-[var(--color-border)] text-[var(--color-text)]'}`}
                      >
                        {step.skipped ? 'Do it now' : 'Go'} <ArrowRight size={12} />
                      </Link>
                      {step.skipped ? (
                        <button type="button" onClick={() => skip(step.key, false)} className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                          <Undo2 size={12} /> Put back on the list
                        </button>
                      ) : (
                        <button type="button" onClick={() => skip(step.key, true)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                          Skip for now
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button type="button" onClick={startTour} className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">
          <Compass size={12} /> Take the tour
        </button>
        {status.complete && (
          <button type="button" onClick={hide} className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X size={12} /> {status.allDone ? 'All done - hide this list' : 'Hide this list'}
          </button>
        )}
      </div>
    </div>
  );
}
