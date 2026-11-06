import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, Sparkles, MessageCircle, Users, CheckCircle2 } from 'lucide-react';
import { useOnboarding } from './onboardingStore';
import SetupChecklist from './SetupChecklist';
import { runTour } from './tour';
import Logo from '../Logo';

/**
 * Mounted once in the admin layout: keeps the onboarding status fresh, shows
 * the welcome screen (once per workspace), the checklist panel, and runs the
 * tour (automatically on a person's first login, or from Help / the checklist).
 */
export default function OnboardingHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const status = useOnboarding((s) => s.status);
  const load = useOnboarding((s) => s.load);
  const checklistOpen = useOnboarding((s) => s.checklistOpen);
  const tourRequested = useOnboarding((s) => s.tourRequested);
  const autoTourDone = useRef(false);

  // Refresh when the page changes (steps tick themselves off as you go).
  useEffect(() => { load(); }, [location.pathname, location.search, load]);

  // First login: the tour starts by itself once the welcome screen isn't in the way.
  useEffect(() => {
    if (!status || autoTourDone.current) return;
    if (!status.showWelcome && status.showTour) {
      autoTourDone.current = true;
      useOnboarding.setState({ tourRequested: true });
    }
  }, [status]);

  useEffect(() => {
    if (!tourRequested) return;
    // Already running (e.g. "Start setup" and the first-login start at the same moment): just once.
    if (useOnboarding.getState().tourRunning) { useOnboarding.setState({ tourRequested: false }); return; }
    useOnboarding.setState({ tourRequested: false, tourRunning: true });
    autoTourDone.current = true;
    runTour({
      navigate,
      onEnd: () => {
        useOnboarding.setState({ tourRunning: false });
        const st = useOnboarding.getState();
        st.tourSeen();
        // After the tour, show what's left to set up.
        if (st.status && !st.status.complete) st.openChecklist();
      },
    });
  }, [tourRequested, navigate]);

  return (
    <>
      {status?.showWelcome && <Welcome />}
      {checklistOpen && <ChecklistPanel />}
    </>
  );
}

function Welcome() {
  const welcomeSeen = useOnboarding((s) => s.welcomeSeen);
  const tourSeen = useOnboarding((s) => s.tourSeen);
  const startTour = useOnboarding((s) => s.startTour);

  async function start() {
    await welcomeSeen();
    startTour();
  }
  async function later() {
    await welcomeSeen();
    await tourSeen(); // they chose not to - the tour is in Help whenever they want it
    useOnboarding.getState().openChecklist();
  }

  const points = [
    { icon: MessageCircle, text: 'Your assistant answers customers on WhatsApp, in your voice.' },
    { icon: CheckCircle2, text: 'Anything sensitive - prices, payments - waits for your OK first.' },
    { icon: Users, text: 'Every customer becomes a lead you can follow up.' },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="cc-welcome-title">
      <div className="w-full sm:max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-[var(--color-brand)] text-white px-6 py-5 flex items-center gap-3">
          <Logo onDark />
          <h2 id="cc-welcome-title" className="text-lg font-semibold font-[var(--font-display)]">Welcome to CodeCraft</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-[var(--color-text)]">
            CodeCraft gives your business an AI assistant that chats with your customers, answers their questions and keeps track of every lead - while you stay in control.
          </p>
          <ul className="space-y-2">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-sm text-[var(--color-text-muted)]">
                <Icon size={16} className="text-[var(--color-accent)] shrink-0 mt-0.5" /> {text}
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--color-text-muted)]">Setup takes about 10 minutes. You can skip any step and come back later.</p>
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
            <button type="button" onClick={later} className="px-4 py-2 rounded-md text-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              Maybe later
            </button>
            <button type="button" onClick={start} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black hover:brightness-110">
              <Sparkles size={15} /> Start setup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChecklistPanel() {
  const close = useOnboarding((s) => s.closeChecklist);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="fixed inset-0 z-[55] flex justify-end bg-black/30" onClick={close}>
      <aside
        className="h-full w-full sm:w-[400px] bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
        aria-label="Setup checklist"
      >
        <div className="flex justify-end -mt-1 -mr-1 mb-1">
          <button type="button" onClick={close} aria-label="Close" className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>
        </div>
        <SetupChecklist onNavigate={close} />
      </aside>
    </div>
  );
}
