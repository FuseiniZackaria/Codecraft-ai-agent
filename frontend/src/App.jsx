import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import CommandPalette from './components/CommandPalette';
import ConnectorPrompt from './components/ConnectorPrompt';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Console from './pages/Console';
import Skills from './pages/Skills';
import Tasks from './pages/Tasks';
import Research from './pages/Research';
import Plugins from './pages/Plugins';
import Workflows from './pages/Workflows';
import Analytics from './pages/Analytics';
import Chat from './pages/Chat';
import { useStore } from './store/useStore';

export default function App() {
  const refresh = useStore((s) => s.refresh);
  const loadChatHistory = useStore((s) => s.loadChatHistory);
  const tasks = useStore((s) => s.tasks);
  const pendingCount = tasks.filter((t) => t.status === 'pending_approval').length;

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 8000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    loadChatHistory(); // one-time hydration, not part of the repeating refresh cycle
  }, [loadChatHistory]);

  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) CodeCraft AI` : 'CodeCraft AI';
  }, [pendingCount]);

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)] font-[var(--font-body)]">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/console" element={<Console />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/research" element={<Research />} />
            <Route path="/workflows" element={<Workflows />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/plugins" element={<Plugins />} />
            <Route path="/chat" element={<Chat />} />
          </Routes>
        </main>
      </div>
      <CommandPalette />
      <ConnectorPrompt />
    </div>
  );
}
