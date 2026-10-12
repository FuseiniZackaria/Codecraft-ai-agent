import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, ShieldAlert, Activity, RefreshCw, Trash, Mail, Building, UserPlus } from 'lucide-react';
import { api } from '../services/api';
import { useStore } from '../store/useStore';

function formatDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString();
}

function AddAdminForm({ onAdded }) {
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState('new_workspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const user = useStore((s) => s.user);
  const isOwner = user?.workspaceRole === 'owner';

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError('Enter an email.');
    setBusy(true);
    try {
      const res = await api.addAdmin(email.trim(), mode);
      setResult(res);
      setEmail('');
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!isOwner) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4">
        <div className="text-sm text-[var(--color-text-muted)]">
          Only the workspace owner can add or remove team members.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4 space-y-3">
      <div className="text-sm font-medium">Add someone</div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            autoComplete="off"
            className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-base md:text-sm outline-none focus:border-[var(--color-accent)]/50"
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs text-[var(--color-text-muted)] mb-1">How should they join?</legend>

          <label
            className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
              mode === 'new_workspace'
                ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/5'
                : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/30'
            }`}
          >
            <input
              type="radio"
              name="addMode"
              value="new_workspace"
              checked={mode === 'new_workspace'}
              onChange={() => setMode('new_workspace')}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Building size={14} />
                New business (own workspace)
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                They get their own empty workspace with separate data, connections, and business profile. This is the default.
              </p>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
              mode === 'team_member'
                ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/5'
                : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/30'
            }`}
          >
            <input
              type="radio"
              name="addMode"
              value="team_member"
              checked={mode === 'team_member'}
              onChange={() => setMode('team_member')}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <UserPlus size={14} />
                Team member of my workspace
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                They join your workspace and see your data, tasks, and connections.
              </p>
            </div>
          </label>
        </fieldset>

        {mode === 'team_member' && (
          <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 flex items-start gap-2">
            <ShieldAlert size={14} className="shrink-0 mt-0.5 text-[var(--color-warning)]" />
            <div className="text-xs text-[var(--color-text-muted)]">
              This person will have full access to your workspace: tasks, chat history, connected accounts,
              and business profile. Only add people you trust.
            </div>
          </div>
        )}

        {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={14} />
          {busy ? 'Adding…' : 'Send invite'}
        </button>
      </form>

      {result && (
        <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 p-3 space-y-2">
          {result.alreadyMember ? (
            <>
              <div className="text-sm font-medium text-[var(--color-success)]">Already a member</div>
              <p className="text-xs text-[var(--color-text-muted)]">
                <strong>{result.email}</strong> is already in your workspace.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-success)]">
                <Mail size={14} />
                {result.existingAccount ? 'Added' : 'Invite sent'}
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                {result.existingAccount ? (
                  <>
                    <strong>{result.email}</strong> already had an account and has been{' '}
                    {result.mode === 'team_member' ? 'added to your workspace' : 'given their own workspace'}.
                  </>
                ) : (
                  <>
                    An invite email has been sent to <strong>{result.email}</strong>.
                    They'll set their own password when they click the link.
                    {result.mode === 'new_workspace' && ' A new workspace has been created for them.'}
                  </>
                )}
              </p>
            </>
          )}
          <button
            type="button"
            onClick={() => setResult(null)}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function AdminRow({ admin, onRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const user = useStore((s) => s.user);
  const isOwner = user?.workspaceRole === 'owner';

  async function handleRemove() {
    if (!window.confirm(`Remove ${admin.email || admin.id} from the team?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeAdmin(admin.id);
      onRemoved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium break-all min-w-0">{admin.email || admin.id}</span>
          {admin.isYou && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)] shrink-0">
              you
            </span>
          )}
          {admin.workspaceRole && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${
              admin.workspaceRole === 'owner'
                ? 'border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
            }`}>
              {admin.workspaceRole}
            </span>
          )}
          {!admin.inMyWorkspace && !admin.isYou && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] shrink-0">
              other workspace
            </span>
          )}
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)]">
          Last sign-in: {formatDate(admin.lastSignInAt)}
        </div>
        {error && <div className="text-[11px] text-[var(--color-danger)] mt-1">{error}</div>}
      </div>
      {!admin.isYou && isOwner && admin.inMyWorkspace && (
        <button
          type="button"
          disabled={busy}
          onClick={handleRemove}
          title="Remove from team"
          className="shrink-0 self-end sm:self-auto flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/40 disabled:opacity-40"
        >
          <Trash2 size={12} />
          {busy ? 'Removing…' : 'Remove'}
        </button>
      )}
    </div>
  );
}

function WorkspaceHealth() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.getWorkspaceShadowLog(200);
      setData(result);
      setLoadedAt(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearLog() {
    if (!window.confirm('Clear the workspace shadow log? This wipes the local diagnostic file; it does NOT touch audit_log or any real database row.')) return;
    setClearing(true);
    setError(null);
    try {
      await api.clearWorkspaceShadowLog();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const total = data?.total || 0;
  const scoreboard = data?.byMethodReason ? Object.entries(data.byMethodReason).sort((a, b) => b[1] - a[1]) : [];
  const recent = Array.isArray(data?.entries) ? data.entries.slice(-20).reverse() : [];

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-[var(--color-accent)] shrink-0" />
          <div className="text-sm font-medium">Workspace health</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearLog}
            disabled={clearing || busy}
            title="Wipe the local shadow log file (does not touch audit_log or any real DB row)"
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/40 disabled:opacity-50"
          >
            <Trash size={11} />
            {clearing ? 'Clearing…' : 'Clear log'}
          </button>
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 disabled:opacity-50"
          >
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
            {busy ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mb-2">
        Store calls that did not pass a workspace scope, or attempted a cross-workspace write.
      </p>
      {data?.mode && (
        <div className={`text-[11px] inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border mb-3 ${
          data.mode === 'enforce'
            ? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]'
            : 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
        }`}>
          Guard mode: <span className="font-[var(--font-mono)]">{data.mode}</span>
          {data.mode === 'log'
            ? ' — misses are logged but not blocked (set WORKSPACE_GUARD_MODE=enforce on the server to flip)'
            : ' — unscoped user calls are refused with an error'}
        </div>
      )}

      {error && (
        <div className="text-xs text-[var(--color-danger)] mb-2">{error}</div>
      )}

      {data && (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <div className={`text-2xl font-semibold ${total === 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>
              {total}
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              shadow-log {total === 1 ? 'entry' : 'entries'}
              {loadedAt && ` · as of ${loadedAt.toLocaleTimeString()}`}
            </div>
          </div>

          {scoreboard.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">By method · reason</div>
              <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
                {scoreboard.map(([key, count]) => (
                  <div key={key} className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-[var(--color-border)] last:border-0">
                    <span className="font-[var(--font-mono)] truncate">{key}</span>
                    <span className="text-[var(--color-text-muted)] shrink-0 ml-2">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recent.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                Last {recent.length} entries
              </summary>
              <div className="mt-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] max-h-60 overflow-auto font-[var(--font-mono)] text-[10px] text-[var(--color-text-muted)]">
                {recent.map((e, i) => (
                  <div key={i} className="px-2 py-1 border-b border-[var(--color-border)] last:border-0 whitespace-pre-wrap break-all">
                    {JSON.stringify(e)}
                  </div>
                ))}
              </div>
            </details>
          )}

          {total === 0 && !error && (
            <div className="text-xs text-[var(--color-success)]">
              Clean. Every tracked store call is scoped to a workspace.
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Team() {
  const [admins, setAdmins] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const user = useStore((s) => s.user);
  const isOwner = user?.workspaceRole === 'owner';

  async function refresh() {
    try {
      setError(null);
      setAdmins(await api.listTeam());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Users size={20} className="text-[var(--color-accent)] shrink-0" />
        <h1 className="font-[var(--font-display)] text-xl font-semibold truncate">Team</h1>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Manage who can access this dashboard. Each person gets an email invite to set their own password.
      </p>

      <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 mb-4 flex items-start gap-2">
        <ShieldAlert size={14} className="shrink-0 mt-0.5 text-[var(--color-warning)]" />
        <div className="text-xs text-[var(--color-text-muted)]">
          New admins receive an email invite and set their own password — you never see or handle it.
          {isOwner ? ' Team members share your workspace data; new businesses get their own.' : ''}
        </div>
      </div>

      <AddAdminForm onAdded={refresh} />

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {!loaded ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-[var(--color-danger)]">{error}</div>
        ) : admins.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">No admins yet.</div>
        ) : (
          admins.map((a) => <AdminRow key={a.id} admin={a} onRemoved={refresh} />)
        )}
      </div>

      {isOwner && (
        <div className="mt-6">
          <WorkspaceHealth />
        </div>
      )}
    </div>
  );
}
