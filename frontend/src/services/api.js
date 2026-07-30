const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getDashboardSummary: () => request('/dashboard/summary'),
  getAgents: () => request('/agents'),
  getTasks: () => request('/tasks'),
  getTask: (id) => request(`/tasks/${id}`),
  submitGoal: (goal, payload, overrideProvider) =>
    request('/orchestrator/goal', {
      method: 'POST',
      body: JSON.stringify({ goal, payload, overrideProvider }),
    }),
  approveTask: (id) => request(`/tasks/${id}/approve`, { method: 'POST' }),
  rejectTask: (id) => request(`/tasks/${id}/reject`, { method: 'POST' }),
  updateTaskPayload: (id, payload) =>
    request(`/tasks/${id}/payload`, { method: 'PATCH', body: JSON.stringify({ payload }) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  chat: (message, history, attachments) =>
    request('/chat', { method: 'POST', body: JSON.stringify({ message, history, attachments }) }),
  getGmailStatus: () => request('/composio/gmail/status'),
  getRedditStatus: () => request('/composio/reddit/status'),
  getWhatsappStatus: () => request('/composio/whatsapp/status'),
  getGithubStatus: () => request('/composio/github/status'),
  getRecentEvents: (limit = 200) => request(`/events/recent?limit=${limit}`),
  eventsStreamUrl: () => `${BASE_URL}/events/stream`,

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
};

// Shown when the backend isn't reachable, so the shell is still browsable on its own.
export const DEMO = {
  summary: {
    activeAgents: 3,
    installedTools: ['gmail.sendEmail', 'gmail.readInbox', 'github.createRepository'],
    availableProviders: ['mock', 'ai'],
    tasks: { total: 12, pending_approval: 2, done: 9, failed: 1 },
    auditLog: [
      { actor: 'system', action: 'plugin_loaded', target: 'gmail', at: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
      { actor: 'Research Agent', action: 'llm_call', target: 'ai', at: new Date(Date.now() - 1000 * 60 * 12).toISOString() },
      { actor: 'orchestrator', action: 'approval_required', target: 'gmail.sendEmail', at: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
    ],
  },
  agents: [
    { key: 'research', role: 'Research Agent', goals: ['Gather accurate, relevant information'], tools: ['gmail.readInbox'] },
    { key: 'personal-assistant', role: 'Personal Assistant Agent', goals: ['Keep the inbox triaged - draft replies to what genuinely needs one'], tools: ['gmail.readInbox', 'gmail.replyToThread'] },
    { key: 'sales', role: 'Sales Agent', goals: ['Move qualified leads toward a close with relevant, personalized outreach'], tools: ['websearch.search', 'gmail.sendEmail'] },
    { key: 'marketing', role: 'Marketing Agent', goals: ['Draft compelling, on-brand marketing content'], tools: ['websearch.search'] },
    { key: 'ceo', role: 'CEO Agent', goals: ['Think through strategy, priorities, and tradeoffs like a co-founder'], tools: ['websearch.search'] },
    { key: 'support', role: 'Customer Support Agent', goals: ['Resolve customer questions and issues clearly and quickly'], tools: ['gmail.sendEmail'] },
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
