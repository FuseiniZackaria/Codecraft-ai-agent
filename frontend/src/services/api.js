import { supabase } from './supabaseClient';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const BROWSER_TOKEN = import.meta.env.VITE_BROWSER_EXTENSION_TOKEN || null;

async function request(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// /api/browser/* is token-gated (same secret the extension uses) because
// CORS is wide open on this backend - without a check, any website's own
// JS could read your browsing history cross-origin. This mirrors that
// token into the frontend's own requests via a matching Vite env var.
async function browserRequest(path) {
  if (!BROWSER_TOKEN) return null; // not configured - features using this fail quiet, not with an error toast
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-CodeCraft-Token': BROWSER_TOKEN },
  });
  if (!res.ok) return null;
  return res.json();
}

// Same token gate, but for POSTs where the error body itself is useful to
// show (e.g. "server responded with HTTP 404") rather than just failing
// quiet like the read-only browserRequest above.
async function browserPost(path, body) {
  if (!BROWSER_TOKEN) return { ok: false, error: 'VITE_BROWSER_EXTENSION_TOKEN is not configured in the frontend.' };
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CodeCraft-Token': BROWSER_TOKEN },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export const api = {
  getDashboardSummary: () => request('/dashboard/summary'),
  getMe: () => request('/me'),
  getAgents: () => request('/agents'),
  getTasks: () => request('/tasks'),
  getTask: (id) => request(`/tasks/${id}`),
  submitGoal: (goal, payload, overrideProvider) =>
    request('/orchestrator/goal', {
      method: 'POST',
      body: JSON.stringify({ goal, payload, overrideProvider }),
    }),
  submitDepartmentGoal: (goal, departmentKey, agentKey) =>
    request('/orchestrator/goal', {
      method: 'POST',
      body: JSON.stringify({ goal, departmentKey, agentKey }),
    }),
  approveTask: (id) => request(`/tasks/${id}/approve`, { method: 'POST' }),
  rejectTask: (id) => request(`/tasks/${id}/reject`, { method: 'POST' }),
  updateTaskPayload: (id, payload) =>
    request(`/tasks/${id}/payload`, { method: 'PATCH', body: JSON.stringify({ payload }) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  bulkDeleteTasks: (ids) => request('/tasks/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  markAllTasksRead: () => request('/tasks/mark-all-read', { method: 'POST' }),
  chat: (message, history, attachments) =>
    request('/chat', { method: 'POST', body: JSON.stringify({ message, history, attachments }) }),
  chatStream: async (message, { scope = null, attachments = [], voice = false, onEvent, signal }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

    const res = await fetch(`${BASE_URL}/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, scope, attachments, voice }),
      signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Stream failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const event = JSON.parse(line.slice(6));
          onEvent?.(event);
          if (event.type === 'done' || event.type === 'error') return event;
        } catch {}
      }
    }
    return { type: 'done', task_ids: [] };
  },
  getAssistantUsage: () => request('/assistant/usage'),
  getPublicConfig: async () => {
    const res = await fetch(`${BASE_URL}/public-config`);
    if (!res.ok) throw new Error(`Public config failed: ${res.status}`);
    return res.json();
  },
  getGmailStatus: () => request('/composio/gmail/status'),
  getRedditStatus: () => request('/composio/reddit/status'),
  getWhatsappStatus: () => request('/composio/whatsapp/status'),
  getTelegramStatus: () => request('/composio/telegram/status'),
  getGithubStatus: () => request('/composio/github/status'),
   getGooglecalendarStatus: () => request('/composio/googlecalendar/status'),
  getRecentEvents: (limit = 200) => request(`/events/recent?limit=${limit}`),
  eventsStreamUrl: () => `${BASE_URL}/events/stream`,
  getEventsStreamUrl: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return `${BASE_URL}/events/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  // --- Universal Skill Installer ---
  listSkills: () => request('/skills'),
  getSkill: (id) => request(`/skills/${id}`),
  searchRegistry: (q) => request(`/skills/registry/search?q=${encodeURIComponent(q || '')}`),
  previewInstall: (source) => request('/skills/preview', { method: 'POST', body: JSON.stringify({ source }) }),
  installSkill: (source, approvedPermissions) =>
    request('/skills/install', { method: 'POST', body: JSON.stringify({ source, approvedPermissions }) }),
  enableSkill: (id) => request(`/skills/${id}/enable`, { method: 'POST' }),
  disableSkill: (id) => request(`/skills/${id}/disable`, { method: 'POST' }),
  removeSkill: (id) => request(`/skills/${id}`, { method: 'DELETE' }),
  repairSkill: (id) => request(`/skills/${id}/repair`, { method: 'POST' }),
  checkSkillUpdate: (id) => request(`/skills/${id}/update-check`),
  updateSkill: (id, approvedPermissions) =>
    request(`/skills/${id}/update`, { method: 'POST', body: JSON.stringify({ approvedPermissions }) }),

  // --- Workflows ---
  listWorkflows: () => request('/workflows'),
  createWorkflow: (workflow) => request('/workflows', { method: 'POST', body: JSON.stringify(workflow) }),
  updateWorkflow: (id, patch) => request(`/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteWorkflow: (id) => request(`/workflows/${id}`, { method: 'DELETE' }),
  runWorkflowNow: (id) => request(`/workflows/${id}/run-now`, { method: 'POST' }),

  // --- Chat history ---
  getChatHistory: (limit = 200) => request(`/chat/history?limit=${limit}`),

  // --- Graph-based workflows (Phase 1) ---
  listWorkflowDefinitions: () => request('/workflow-definitions'),
  createWorkflowDefinition: (def) => request('/workflow-definitions', { method: 'POST', body: JSON.stringify(def) }),
  runWorkflowDefinition: (id) => request(`/workflow-definitions/${id}/run`, { method: 'POST' }),
  resumeWorkflowRun: (runId) => request(`/workflow-definitions/runs/${runId}/resume`, { method: 'POST' }),
  cancelWorkflowRun: (runId) => request(`/workflow-definitions/runs/${runId}/cancel`, { method: 'POST' }),
  searchWorkflowRegistry: (q = '') => request(`/workflow-definitions/registry/search?q=${encodeURIComponent(q)}`),
  installWorkflowFromRegistry: (id) => request(`/workflow-definitions/registry/${id}/install`, { method: 'POST' }),
  getAnalyticsSummary: (sinceDays = 30) => request(`/analytics/summary?sinceDays=${sinceDays}`),
    getBriefingDashboard: (goal) => request(`/dashboard/briefing?goal=${encodeURIComponent(goal)}`),
  // Returns null if VITE_BROWSER_EXTENSION_TOKEN isn't configured, or if the
  // request fails for any reason - callers should treat null as "nothing to
  // show" rather than an error state.
  getBrowserPrompt: () => browserRequest('/browser/prompt'),

  // --- Team (admin management) ---
  listTeam: () => request('/team'),
  addAdmin: (email, password) => request('/team', { method: 'POST', body: JSON.stringify({ email, password }) }),
  removeAdmin: (userId) => request(`/team/${userId}`, { method: 'DELETE' }),

  connectMCP: (url) => browserPost('/mcp/connect', { url }),

  // Turns a page's own text into a reference skill for agents to consult -
  // never runs the command itself. See core/cliImport.js for the safety
  // reasoning: it's always guidance-kind, never executable.
  importCLIAsSkill: (url, command) => browserPost('/browser/cli/import', { url, command }),
};

// Shown when the backend isn't reachable, so the shell is still browsable on its own.
export const DEMO = {
  summary: {
    activeAgents: 9,
    installedTools: ['gmail.sendEmail', 'gmail.readInbox', 'whatsapp.sendMessage', 'github.createRepository', 'reddit.postComment', 'websearch.search'],
    availableProviders: ['mock', 'ai'],
    tasks: { total: 12, pending_approval: 2, done: 9, failed: 1 },
    auditLog: [
      { actor: 'system', action: 'plugin_loaded', target: 'gmail', at: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
      { actor: 'Research Agent', action: 'llm_call', target: 'ai', at: new Date(Date.now() - 1000 * 60 * 12).toISOString() },
      { actor: 'orchestrator', action: 'approval_required', target: 'gmail.sendEmail', at: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
    ],
  },
  agentSections: [
    { key: 'sales',       label: 'Sales Manager',                      icon: 'TrendingUp'    },
    { key: 'marketing',   label: 'Marketing & Content',                 icon: 'Megaphone'     },
    { key: 'support',     label: 'Customer Support & Communication',    icon: 'Headphones'    },
    { key: 'strategy',    label: 'Strategy & Research',                 icon: 'Compass'       },
    { key: 'development', label: 'Development & Operations',            icon: 'Code2'         },
    { key: 'other',       label: 'Other',                               icon: 'MoreHorizontal'},
  ],
  agents: [
    { key: 'research',          section: 'strategy',    description: 'Looks up information and answers questions through a focused web search.',               role: 'Research Agent',           goals: ['Gather accurate, relevant information for other agents and the user'],                    tools: ['websearch.search'],                                        backgroundJobs: [] },
    { key: 'personal-assistant',section: 'support',     description: 'Triages the Gmail inbox and drafts replies to messages that need a response.',           role: 'Personal Assistant Agent', goals: ['Keep the inbox triaged - draft replies to what genuinely needs one, leave the rest'],   tools: ['gmail.readInbox', 'gmail.replyToThread'],                  backgroundJobs: [] },
    { key: 'sales',             section: 'sales',       description: 'Finds job leads, drafts personalised outreach emails, and manages the pipeline.',        role: 'Sales Agent',              goals: ['Move qualified leads toward a close with relevant, personalised outreach'],              tools: ['websearch.search', 'gmail.sendEmail', 'reddit.postComment'],backgroundJobs: [{ name: 'Queues follow-up emails (Day 4, 10 and 21)', intervalMinutes: 0, enabled: false }] },
    { key: 'whatsapp',          section: 'support',     description: 'Sends WhatsApp messages to contacts on your behalf.',                                    role: 'WhatsApp Agent',           goals: ['Draft timely, on-brand replies to incoming customer messages for human approval'],       tools: ['whatsapp.sendMessage'],                                    backgroundJobs: [] },
    { key: 'support',           section: 'support',     description: 'Drafts replies to individual customer questions, complaints, and issues.',               role: 'Customer Support Agent',   goals: ['Resolve customer questions and issues clearly and quickly'],                            tools: ['gmail.sendEmail'],                                         backgroundJobs: [] },
    { key: 'marketing',         section: 'marketing',   description: 'Drafts individual pieces of marketing content — emails, social posts, and ads.',         role: 'Marketing Agent',          goals: ['Draft compelling, on-brand marketing content - social posts, ad copy, campaigns'],      tools: ['websearch.search'],                                        backgroundJobs: [] },
    { key: 'ceo',               section: 'strategy',    description: 'Gives real recommendations on business strategy, priorities, and tradeoffs.',            role: 'CEO Agent',                goals: ['Think through strategy, priorities, and tradeoffs like a co-founder would'],             tools: ['websearch.search'],                                        backgroundJobs: [] },
    { key: 'coding',            section: 'development', description: 'Builds websites, apps, and systems by writing real files into a workspace.',             role: 'Coding Agent',             goals: ['Build real, working websites and small systems from a plain-language request'],          tools: ['filesystem.writeFile', 'filesystem.listFiles', 'filesystem.zipProject'], backgroundJobs: [] },
    { key: 'content-studio',    section: 'marketing',   description: 'Turns one idea into a full content package: research, campaign strategy, scripts, captions, hashtags.', role: 'Content Studio Agent', goals: ['Turn one idea into a complete, ready-to-use content package: research, strategy, scripts, captions, hashtags'], tools: ['websearch.search'], backgroundJobs: [] },
  ],
  tasks: [
    {
      id: 'demo-1',
      agent: 'research',
      instruction: 'Research our top 3 competitors',
      status: 'done',
      irreversible: false,
      created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      result: [
        {
          answer: 'Zapier, n8n, and AutoGPT are the leading automation platforms competing in this space.',
          results: [
            { title: 'Zapier vs n8n: 2026 Comparison', url: 'https://example.com/zapier-vs-n8n', content: 'A breakdown of pricing, integrations, and ease of use between the two leading workflow automation tools.' },
            { title: 'AutoGPT Overview', url: 'https://example.com/autogpt', content: 'AutoGPT positions itself as an autonomous agent framework rather than a no-code workflow tool.' },
          ],
        },
        { text: '**Zapier** leads on integration breadth (6000+ apps) but is priced per-task, which gets expensive at scale. **n8n** is open-source and self-hostable, appealing to technical teams. **AutoGPT** targets a different segment entirely — autonomous agents rather than triggered workflows.', provider: 'ai', costEstimate: 0.003 },
        { text: 'Bottom line: your differentiation isn\'t workflow breadth (Zapier wins that) — it\'s the multi-agent business-operations angle that none of the three directly target.', provider: 'ai', costEstimate: 0.003 },
      ],
    },
    { id: 'demo-2', agent: 'sales', instruction: 'Send a follow-up email to the prospect', status: 'pending_approval', irreversible: true, created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(), payload: { to: 'prospect@example.com', subject: 'Following up', body: 'Hi there — just checking in after our call last week. Would love to hear your thoughts on the proposal when you get a chance.' } },
    { id: 'demo-3', agent: 'support', instruction: 'Draft reply to angry customer ticket #4521', status: 'pending_approval', irreversible: true, created_at: new Date(Date.now() - 1000 * 60 * 2).toISOString() },
  ],
};
