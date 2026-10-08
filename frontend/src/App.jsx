import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import CommandPalette from './components/CommandPalette';
import ConnectorPrompt from './components/ConnectorPrompt';
import FloatingAssistant from './components/FloatingAssistant';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Console from './pages/Console';
import Skills from './pages/Skills';
import Tasks from './pages/Tasks';
import Plugins from './pages/Plugins';
import Workflows from './pages/Workflows';
import Analytics from './pages/Analytics';
import Chat from './pages/Chat';
import BriefingDashboard from './pages/BriefingDashboard';
import Departments from './pages/Departments';
import DepartmentPage from './pages/DepartmentPage';
import { LogOut, WifiOff } from 'lucide-react';
import { useStore } from './store/useStore';
import { supabase } from './services/supabaseClient';
import ResetPassword from './pages/ResetPassword';


export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking, null = logged out
  const refresh = useStore((s) => s.refresh);
  const refreshConnectors = useStore((s) => s.refreshConnectors);
  const loadChatHistory = useStore((s) => s.loadChatHistory);
  const loadPublicConfig = useStore((s) => s.loadPublicConfig);
  const loadUserRole = useStore((s) => s.loadUserRole);
  const user = useStore((s) => s.user);
  const authLoading = useStore((s) => s.authLoading);
  const connectionError = useStore((s) => s.connectionError);
  const tasks = useStore((s) => s.tasks);
  const pendingCount = tasks.filter((t) => t.status === 'pending_approval').length;
  const backoffRef = useRef(60_000);

    const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    // Pull the Assistant's configured name early so the FAB shows the right
    // initial on first paint, even before login completes.
    loadPublicConfig();
  }, [loadPublicConfig]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadUserRole();
  }, [session, loadUserRole]);

    useEffect(() => {
    if (!user || user.role !== 'admin') return;
    let timer;
    let stopped = false;

    async function tick() {
      if (stopped) return;
      const ok = await refresh();
      if (stopped) return;
      backoffRef.current = ok ? 60_000 : Math.min(backoffRef.current * 2, 60_000);
      timer = setTimeout(tick, backoffRef.current);
    }

    refresh().then((ok) => {
      backoffRef.current = ok ? 60_000 : 5_000;
      if (!stopped) timer = setTimeout(tick, backoffRef.current);
    });

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer);
      } else if (!stopped) {
        refresh().then((ok) => {
          backoffRef.current = ok ? 60_000 : Math.min(backoffRef.current * 2, 60_000);
          clearTimeout(timer);
          if (!stopped) timer = setTimeout(tick, backoffRef.current);
        });
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, refresh]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    loadChatHistory();
  }, [user, loadChatHistory]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    refreshConnectors();
    const interval = setInterval(refreshConnectors, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user, refreshConnectors]);
  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) CodeCraft` : 'CodeCraft';
  }, [pendingCount]);

    if (passwordRecovery) {
    return <ResetPassword />;
  }

  if (session === undefined || (session && authLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text-muted)] text-sm">
        Loading…
      </div>
    );
  }

  if (!session || !user) {
    // If the user landed here from a password-reset email (valid token OR expired),
    // always show ResetPassword so it can render the form or a proper error message.
    // Without this, an expired link silently drops the user onto the Login page with
    // no explanation.
    if (window.location.pathname === '/reset-password') {
      return <ResetPassword />;
    }
    return <Login />;
  }

  // Client role: Intelligence is the only page they're allowed to see.
  // Every other route redirects there rather than rendering admin-only content.
   if (user.role === 'client') {
    return (
      <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)] font-[var(--font-body)]">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-[var(--color-border)]">
            <span className="text-[11px] text-[var(--color-text-muted)]">{user.email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              title="Sign out"
              className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
            >
              <LogOut size={14} />
            </button>
          </div>
          <TopBar />
          {connectionError && (
            <div className="flex items-center justify-center gap-2 bg-[var(--color-warning)]/10 border-b border-[var(--color-warning)]/30 px-4 py-1.5 text-xs text-[var(--color-warning)]">
              <WifiOff size={13} /> {connectionError}
            </div>
          )}
          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/departments/strategy/intelligence" element={<BriefingDashboard />} />
              <Route path="/briefing-dashboard" element={<Navigate to="/departments/strategy/intelligence" replace />} />
              <Route path="*" element={<Navigate to="/departments/strategy/intelligence" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)] font-[var(--font-body)]">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        {connectionError && (
          <div className="flex items-center justify-center gap-2 bg-[var(--color-warning)]/10 border-b border-[var(--color-warning)]/30 px-4 py-1.5 text-xs text-[var(--color-warning)]">
            <WifiOff size={13} /> {connectionError}
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/console" element={<Console />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/workflows" element={<Workflows />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/plugins" element={<Plugins />} />
            <Route path="/chat" element={<Chat />} />

            {/* Department routes */}
            <Route path="/departments" element={<Departments />} />
            <Route path="/departments/:deptKey/*" element={<DepartmentPage />} />

            {/* Redirects for old URLs */}
            <Route path="/agents" element={<Navigate to="/departments" replace />} />
            <Route path="/outreach" element={<Navigate to="/departments/sales/outreach" replace />} />
            <Route path="/research" element={<Navigate to="/departments/strategy/research" replace />} />
            <Route path="/briefing-dashboard" element={<Navigate to="/departments/strategy/intelligence" replace />} />
          </Routes>
        </main>
      </div>
      <CommandPalette />
      <ConnectorPrompt />
      <FloatingAssistant />
    </div>
  );
}