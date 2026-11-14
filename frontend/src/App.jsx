import { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import CommandPalette from './components/CommandPalette';
import ConnectorPrompt from './components/ConnectorPrompt';
import FloatingAssistant from './components/FloatingAssistant';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Console from './pages/Console';
import Skills from './pages/Skills';
import MyComputer from './pages/MyComputer';
import Tasks from './pages/Tasks';
import Workflows from './pages/Workflows';
import Analytics from './pages/Analytics';
import Chat from './pages/Chat';
import BriefingDashboard from './pages/BriefingDashboard';
import Departments from './pages/Departments';
import DepartmentPage from './pages/DepartmentPage';
import Team from './pages/Team';
import Clients from './pages/Clients';
import Settings from './pages/Settings';
import Connections from './pages/Connections';
import ClientTracker from './pages/ClientTracker';
import WhatsAppInbox from './pages/WhatsAppInbox';
import Leads from './pages/Leads';
import WhatsAppReconnectBanner from './components/WhatsAppReconnectBanner';
import OnboardingHost from './components/onboarding/OnboardingHost';
import WhatsAppChatPopup from './components/WhatsAppChatPopup';
import AssistantNavigator from './components/AssistantNavigator';
import NotFound from './pages/NotFound';
import { LogOut, WifiOff } from 'lucide-react';
import { useStore } from './store/useStore';
import { supabase } from './services/supabaseClient';
import ResetPassword from './pages/ResetPassword';
import TabbedLayout from './components/nav/TabbedLayout';
import LoadingScreen from './components/LoadingScreen';
import { REDIRECTS } from './components/nav/navConfig';

/** Redirect an old URL to its new location, keeping ?query (e.g. ?connected= after a Google sign-in) and #hash. */
function RedirectKeepingQuery({ to }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking, null = logged out
  const refresh = useStore((s) => s.refresh);
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

  // Supabase fires onAuthStateChange on token refresh and (in some browsers)
  // on tab focus - each firing hands us a NEW session object with the same
  // user.id. If we naively replace state every time, every downstream
  // effect reruns and we end up re-fetching /api/me, /api/chat/history,
  // /api/dashboard/summary, /api/agents, /api/tasks, and every connector
  // status on each one. Instead, only update `session` when the user
  // actually changed (sign-in, sign-out, or a different user). TOKEN_REFRESHED
  // and spurious SIGNED_IN with the same user are no-ops.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      // Signing in again as the same person after the account failed to load
      // (e.g. the server was asleep): the session doesn't "change", so retry here -
      // otherwise the Sign in button silently did nothing until a page reload.
      if (event === 'SIGNED_IN' && newSession && !useStore.getState().user) {
        useStore.setState({ authLoading: true });
        loadUserRole({ force: true });
      }
      setSession((prev) => {
        const prevId = prev?.user?.id || null;
        const nextId = newSession?.user?.id || null;
        if (prevId === nextId) return prev; // identity-stable: no re-render, no effect reruns
        return newSession;
      });
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // The session-change effect only re-fires when the user.id ACTUALLY
  // changes (see the identity-stable updater above), so a fetch here is
  // always for a different user than the one in the store - force it to
  // bypass the loadUserRole cache.
  useEffect(() => {
    if (session) loadUserRole({ force: true });
  }, [session, loadUserRole]);

  // Dashboard / agents / tasks refresh loop. Keyed on user?.id (not user) so
  // a new user object with the same id doesn't restart the whole timer.
  // Paused entirely while the tab is hidden; one catch-up refresh on return.
  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) return;
    let timer;
    let stopped = false;

    async function tick() {
      if (stopped || document.visibilityState === 'hidden') return;
      const ok = await refresh();
      if (stopped) return;
      backoffRef.current = ok ? 60_000 : Math.min(backoffRef.current * 2, 60_000);
      timer = setTimeout(tick, backoffRef.current);
    }

    refresh().then((ok) => {
      backoffRef.current = ok ? 60_000 : 5_000;
      if (!stopped && document.visibilityState !== 'hidden') {
        timer = setTimeout(tick, backoffRef.current);
      }
    });

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer); // pause - no fetches while the tab is backgrounded
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
  }, [user?.id, user?.role, refresh]);

  // Chat history and connector status are now fetched from the pages that
  // display them (Chat page, Plugins page). The admin shell no longer
  // reloads either on every auth state change.

  // Any 401 from the authenticated API helper fires `cc:unauthorized` once.
  // Sign the user out exactly once in response - the auth state change below
  // then routes to Login, which stops every background request this shell
  // kicked off (refresh loop, SSE streams, connector refresh, etc.) because
  // they're all gated on `user`.
  useEffect(() => {
    // api.js fires this once per session (the latch resets on the next sign-in),
    // so every later session can be signed out too - not just the first one.
    function onUnauthorized() {
      if (!useStore.getState().authError) {
        useStore.setState({ authError: 'You were signed out because the CodeCraft server no longer accepted your session. Please sign in again.' });
      }
      supabase.auth.signOut().catch(() => { /* ignore - the state change still fires */ });
    }
    window.addEventListener('cc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('cc:unauthorized', onUnauthorized);
  }, []);
  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) CodeCraft` : 'CodeCraft';
  }, [pendingCount]);

    if (passwordRecovery) {
    return <ResetPassword />;
  }

  // Invited users arrive signed in by the invite link but without a password.
  // Until they create one they only see this screen, so they can sign in
  // again after logging out.
  if (session?.user?.user_metadata?.needs_password) {
    return <ResetPassword mode="invite" />;
  }

  if (session === undefined || (session && authLoading)) {
    return <LoadingScreen />;
  }

  if (!session || !user) {
    // If the user landed here from a password-reset email (valid token OR expired),
    // always show ResetPassword so it can render the form or a proper error message.
    // Without this, an expired link silently drops the user onto the Login page with
    // no explanation.
    if (window.location.pathname === '/reset-password') {
      return <ResetPassword />;
    }
    // Expired / already-used invite link.
    if (window.location.pathname === '/set-password') {
      return <ResetPassword mode="invite" />;
    }
    return <Login />;
  }

  // Client role: Intelligence is the only page they're allowed to see.
  // Every other route redirects there rather than rendering admin-only content.
   if (user.role === 'client') {
    return (
      <div className="flex h-dvh bg-[var(--color-bg)] text-[var(--color-text)] font-[var(--font-body)]">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-[var(--color-border)]">
            <span className="text-[11px] text-[var(--color-text-muted)] truncate min-w-0">{user.email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              title="Sign out"
              className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] shrink-0"
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
          <main className="flex-1 overflow-y-auto bg-[var(--color-surface-2)]">
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

  return <AdminLayout connectionError={connectionError} />;
}

function AdminLayout({ connectionError }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes (link tapped inside it,
  // or a programmatic navigation elsewhere).
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Esc closes it.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="flex h-dvh bg-[var(--color-bg)] text-[var(--color-text)] font-[var(--font-body)]">
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar onOpenSidebar={() => setSidebarOpen(true)} />
        <OnboardingHost />
        <WhatsAppChatPopup />
        <AssistantNavigator />
        <WhatsAppReconnectBanner />
        {connectionError && (
          <div className="flex items-center justify-center gap-2 bg-[var(--color-warning)]/10 border-b border-[var(--color-warning)]/30 px-4 py-1.5 text-xs text-[var(--color-warning)]">
            <WifiOff size={13} /> {connectionError}
          </div>
        )}
        <main className="flex-1 overflow-y-auto bg-[var(--color-surface-2)]">
          <Routes>
            {/* Tabbed sections (tabs and nav items come from components/nav/navConfig.js) */}
            <Route path="/home" element={<TabbedLayout navKey="home" />}>
              <Route index element={<Dashboard />} />
              <Route path="analytics" element={<Analytics />} />
            </Route>
            <Route path="/chat" element={<TabbedLayout navKey="chat" fill />}>
              <Route index element={<Chat />} />
              <Route path="console" element={<Console />} />
            </Route>
            <Route path="/work" element={<TabbedLayout navKey="work" />}>
              <Route index element={<Tasks />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="clients" element={<ClientTracker />} />
              <Route path="inbox" element={<WhatsAppInbox />} />
              <Route path="leads" element={<Leads />} />
            </Route>
            <Route path="/toolbox" element={<TabbedLayout navKey="toolbox" />}>
              {/* Connections is the Toolbox's main page (the old Plugins page duplicated it). */}
              <Route index element={<Navigate to="connections" replace />} />
              <Route path="skills" element={<Skills />} />
              <Route path="connections" element={<Connections />} />
              <Route path="computer" element={<MyComputer />} />
            </Route>
            <Route path="/settings" element={<TabbedLayout navKey="settings" />}>
              <Route index element={<Settings />} />
              <Route path="team" element={<Team />} />
              <Route path="clients" element={<Clients />} />
            </Route>

            {/* Department routes */}
            <Route path="/departments" element={<Departments />} />
            <Route path="/departments/:deptKey/*" element={<DepartmentPage />} />

            {/* Old URLs -> new locations, keeping ?query and #hash */}
            {Object.entries(REDIRECTS).map(([from, to]) => (
              <Route key={from} path={from} element={<RedirectKeepingQuery to={to} />} />
            ))}

            {/* Catch-all - a real in-app "page not found" instead of a blank <main>. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
      <CommandPalette />
      <ConnectorPrompt />
      <FloatingAssistant />
    </div>
  );
}