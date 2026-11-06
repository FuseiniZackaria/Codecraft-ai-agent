import { create } from 'zustand';
import { api } from '../../services/api';

/**
 * Onboarding state shared by the welcome screen, the sidebar setup card, the
 * Dashboard checklist, the Help menu and the tour. The server works out which
 * steps are done (from the real data), so `load()` is all it takes to refresh.
 */
export const useOnboarding = create((set, get) => ({
  status: null,
  loadedAt: 0,
  checklistOpen: false,
  tourRequested: false, // set to start the tour (the host runs it)
  tourRunning: false,

  async load({ force = false } = {}) {
    if (!force && Date.now() - get().loadedAt < 15000) return get().status;
    set({ loadedAt: Date.now() });
    try {
      const status = await api.getOnboarding();
      set({ status });
      return status;
    } catch {
      return get().status; // onboarding must never break the app
    }
  },
  async act(call) {
    try {
      const status = await call();
      set({ status, loadedAt: Date.now() });
    } catch {
      /* keep the current state; the next load() catches up */
    }
  },
  welcomeSeen: () => get().act(() => api.onboardingWelcomeSeen()),
  skip: (step, skipped = true) => get().act(() => api.onboardingSkip(step, skipped)),
  hide: () => get().act(() => api.onboardingHide(true)),
  tourSeen: () => get().act(() => api.onboardingTourSeen()),

  openChecklist: () => set({ checklistOpen: true }),
  closeChecklist: () => set({ checklistOpen: false }),
  startTour: () => set({ tourRequested: true, checklistOpen: false }),
}));
