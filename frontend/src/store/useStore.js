import { create } from 'zustand';
import { api, DEMO } from '../services/api';
import { supabase } from '../services/supabaseClient';

export const useStore = create((set, get) => ({
  connected: false,
  loading: true,
  authLoading: true,
  connectionError: null,
  user: null,

  async signOut() {
    await supabase.auth.signOut();
    set({ user: null });
  },

    async loadUserRole() {
    try {
      const me = await api.getMe();
      set({ user: me, authLoading: false, connected: true, loading: false });
    } catch {
      set({ user: null, authLoading: false, connected: false, loading: false });
    }
  },
  summary: DEMO.summary,
  agents: DEMO.agents,
  agentSections: DEMO.agentSections,
  tasks: DEMO.tasks,
  paletteOpen: false,
  gmailConnected: false,
  redditConnected: false,
  whatsappConnected: false,
  githubConnected: false,
  googlecalendarConnected: false,
  telegramConnected: false,
  chatMessages: JSON.parse(localStorage.getItem('cc_chat') || '[]'),

  // Floating-assistant session state - lives in the store (not a component)
  // so the stream and panel state survive route changes.
  assistant: {
    name: 'Ian',
    nameVariations: ['Ian', 'Ean', 'Ion', 'Eon', 'Ayan', 'Iain', 'Jan'],
    panelOpen: false,
    streaming: false,
    streamingReply: '',
    activeTool: null,
    triggerMode: localStorage.getItem('cc_assistant_trigger_mode') || 'every', // 'every' | 'name'
    spokenReplies: localStorage.getItem('cc_assistant_tts') === 'on',
    voiceMode: false,
    listening: false,
    corner: localStorage.getItem('cc_assistant_corner') || 'br', // br | bl | tr | tl
    ignoredHint: null, // short "Say Ian to get my attention" hint
  },

  setAssistant: (patch) => set((state) => ({ assistant: { ...state.assistant, ...patch } })),

  async loadPublicConfig() {
    try {
      const cfg = await api.getPublicConfig();
      set((state) => ({
        assistant: {
          ...state.assistant,
          name: cfg.assistantName || state.assistant.name,
          nameVariations: cfg.assistantNameVariations || state.assistant.nameVariations,
        },
      }));
    } catch {
      // keep defaults
    }
  },

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  addChatMessage: (msg) =>
    set((state) => {
      const chatMessages = [...state.chatMessages, msg];
      localStorage.setItem('cc_chat', JSON.stringify(chatMessages));
      return { chatMessages };
    }),

  // One-time hydration from the backend on app mount - chat history now
  // lives server-side (survives a refresh or a different device/browser).
  // localStorage stays as an offline fallback: used as the initial state
  // above, and kept in sync here so it's still useful if the backend is
  // ever unreachable later in the session.
  async loadChatHistory() {
    try {
      const serverMessages = await api.getChatHistory();
      const chatMessages = serverMessages.map((m) => ({
        role: m.role,
        content: m.content,
        attachmentNames: m.attachmentNames,
        task: m.taskId ? { id: m.taskId } : undefined,
      }));
      localStorage.setItem('cc_chat', JSON.stringify(chatMessages));
      set({ chatMessages });
    } catch {
      // Backend not reachable - keep whatever was already loaded from
      // localStorage as a reasonable offline fallback.
    }
  },

  async refresh() {
    try {
      const [summary, agentsResponse, tasks] = await Promise.all([
        api.getDashboardSummary(),
        api.getAgents(),
        api.getTasks(),
      ]);
      const agents = Array.isArray(agentsResponse) ? agentsResponse : (agentsResponse.agents || []);
      const agentSections = Array.isArray(agentsResponse) ? DEMO.agentSections : (agentsResponse.sections || DEMO.agentSections);
      set({ summary, agents, agentSections, tasks, connected: true, loading: false, connectionError: null });
      return true;
    } catch {
      set({ connected: false, loading: false, connectionError: 'Connection problem — retrying…' });
      return false;
    }
  },

  async refreshConnectors() {
    try {
      const results = await Promise.allSettled([
        api.getGmailStatus(),
        api.getRedditStatus(),
        api.getWhatsappStatus(),
        api.getGithubStatus(),
        api.getGooglecalendarStatus(),
        api.getTelegramStatus(),
      ]);
      const val = (i) => results[i].status === 'fulfilled' && results[i].value?.connected;
      set({
        gmailConnected: val(0),
        redditConnected: val(1),
        whatsappConnected: val(2),
        githubConnected: val(3),
        googlecalendarConnected: val(4),
        telegramConnected: val(5),
      });
    } catch {
      // ignore — connector status is non-critical
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

  async resumeWorkflowRun(runId) {
    if (!get().connected) return;
    await api.resumeWorkflowRun(runId);
    await get().refresh();
  },

  async cancelWorkflowRun(runId) {
    if (!get().connected) return;
    await api.cancelWorkflowRun(runId);
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

  /**
   * Single streaming send used by both the full /chat page and the floating
   * Assistant panel. Owns the fetch so navigating between pages doesn't
   * abort it. Only one stream in flight at a time - a second call while
   * streaming is a no-op.
   */
  async sendMessage({ text, scope = null, voice = false, attachments = [] }) {
    const state = get();
    if (state.assistant.streaming) return null;
    const trimmed = (text || '').trim();
    if (!trimmed && !attachments.length) return null;

    const attachmentNames = attachments.map((a) => a.name).filter(Boolean);
    const displayText = trimmed || (attachmentNames.length ? `Sent ${attachmentNames.length === 1 ? attachmentNames[0] : `${attachmentNames.length} files`}` : '');
    get().addChatMessage({ role: 'user', content: displayText, attachmentNames });

    set((s) => ({ assistant: { ...s.assistant, streaming: true, streamingReply: '', activeTool: null, ignoredHint: null } }));

    let accumulated = '';
    let notice = null;
    const taskIds = [];

    try {
      await api.chatStream(trimmed, {
        scope,
        voice,
        attachments,
        onEvent: (event) => {
          if (event.type === 'text_delta') {
            accumulated += event.text;
            set((s) => ({ assistant: { ...s.assistant, streamingReply: accumulated } }));
          } else if (event.type === 'tool_start') {
            set((s) => ({ assistant: { ...s.assistant, activeTool: event.name } }));
          } else if (event.type === 'tool_end') {
            set((s) => ({ assistant: { ...s.assistant, activeTool: null } }));
            if (event.result?.task_id) taskIds.push(event.result.task_id);
          } else if (event.type === 'notice') {
            notice = event.text;
          } else if (event.type === 'done') {
            if (Array.isArray(event.task_ids)) {
              for (const id of event.task_ids) if (!taskIds.includes(id)) taskIds.push(id);
            }
          } else if (event.type === 'error') {
            notice = `Error: ${event.error}`;
          }
        },
      });

      const finalText = notice ? `${notice}\n\n${accumulated}` : accumulated;
      const reply = finalText || "I didn't get a reply - try again?";
      get().addChatMessage({
        role: 'assistant',
        content: reply,
        task: taskIds[0] ? { id: taskIds[0] } : undefined,
      });
      if (taskIds.length) await get().refresh();
      return { reply, accumulated, taskIds };
    } catch (err) {
      get().addChatMessage({ role: 'assistant', content: `Something went wrong: ${err.message}` });
      return { error: err.message };
    } finally {
      set((s) => ({ assistant: { ...s.assistant, streaming: false, streamingReply: '', activeTool: null } }));
    }
  },

  setTriggerMode(mode) {
    localStorage.setItem('cc_assistant_trigger_mode', mode);
    set((s) => ({ assistant: { ...s.assistant, triggerMode: mode } }));
  },

  setSpokenReplies(on) {
    localStorage.setItem('cc_assistant_tts', on ? 'on' : 'off');
    set((s) => ({ assistant: { ...s.assistant, spokenReplies: !!on } }));
  },

  setCorner(corner) {
    localStorage.setItem('cc_assistant_corner', corner);
    set((s) => ({ assistant: { ...s.assistant, corner } }));
  },

  async markAllTasksRead() {
    if (!get().connected) return;
    await api.markAllTasksRead();
    await get().refresh();
  },
}));