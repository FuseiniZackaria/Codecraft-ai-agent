import { create } from 'zustand';
import { api, DEMO } from '../services/api';

export const useStore = create((set, get) => ({
  connected: false,
  loading: true,
  summary: DEMO.summary,
  agents: DEMO.agents,
  tasks: DEMO.tasks,
  paletteOpen: false,
  gmailConnected: false,
  redditConnected: false,
  whatsappConnected: false,
  githubConnected: false,
  chatMessages: JSON.parse(localStorage.getItem('cc_chat') || '[]'),

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  addChatMessage: (msg) =>
    set((state) => {
      const chatMessages = [...state.chatMessages, msg];
      localStorage.setItem('cc_chat', JSON.stringify(chatMessages));
      return { chatMessages };
    }),

  async refresh() {
    try {
      const [summary, agents, tasks] = await Promise.all([
        api.getDashboardSummary(),
        api.getAgents(),
        api.getTasks(),
      ]);
      set({ summary, agents, tasks, connected: true, loading: false });

      api.getGmailStatus()
        .then(({ connected }) => set({ gmailConnected: connected }))
        .catch(() => set({ gmailConnected: false }));

      api.getRedditStatus()
        .then(({ connected }) => set({ redditConnected: connected }))
        .catch(() => set({ redditConnected: false }));

      api.getWhatsappStatus()
        .then(({ connected }) => set({ whatsappConnected: connected }))
        .catch(() => set({ whatsappConnected: false }));

      api.getGithubStatus()
        .then(({ connected }) => set({ githubConnected: connected }))
        .catch(() => set({ githubConnected: false }));
    } catch {
      // Backend not reachable - stay on demo data so the shell is still usable.
      set({ connected: false, loading: false });
    }
  },

  async submitGoal(goal, payload) {
    if (!get().connected) return null;
    const result = await api.submitGoal(goal, payload);
    await get().refresh();
    return result;
  },

  async approveTask(id) {
    if (!get().connected) return;
    await api.approveTask(id);
    await get().refresh();
  },

  async rejectTask(id) {
    if (!get().connected) return;
    await api.rejectTask(id);
    await get().refresh();
  },

  async updateTaskPayload(id, payload) {
    if (!get().connected) return;
    await api.updateTaskPayload(id, payload);
    await get().refresh();
  },

  async deleteTask(id) {
    if (!get().connected) return;
    await api.deleteTask(id);
    await get().refresh();
  },
}));
