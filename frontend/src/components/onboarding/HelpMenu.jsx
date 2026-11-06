import { useEffect, useRef, useState } from 'react';
import { HelpCircle, Sparkles, ListChecks } from 'lucide-react';
import { useOnboarding } from './onboardingStore';

/** "?" in the top bar: replay the tour or open the setup checklist, any time. */
export default function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const startTour = useOnboarding((s) => s.startTour);
  const openChecklist = useOnboarding((s) => s.openChecklist);
  const status = useOnboarding((s) => s.status);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const item = 'w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-[var(--color-text)] hover:bg-[var(--color-surface-2)]';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-tour="help"
        onClick={() => setOpen((o) => !o)}
        aria-label="Help"
        aria-expanded={open}
        className="p-2 rounded-md text-white/80 hover:text-white hover:bg-white/10"
      >
        <HelpCircle size={18} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl py-1 z-50">
          <button type="button" className={item} onClick={() => { setOpen(false); startTour(); }}>
            <Sparkles size={15} className="text-[var(--color-accent)]" /> Take the tour
          </button>
          <button type="button" className={item} onClick={() => { setOpen(false); openChecklist(); }}>
            <ListChecks size={15} className="text-[var(--color-accent)]" /> Setup checklist
            {status && <span className="ml-auto text-xs text-[var(--color-text-muted)]">{status.doneCount}/{status.total}</span>}
          </button>
        </div>
      )}
    </div>
  );
}
