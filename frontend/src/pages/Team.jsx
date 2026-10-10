import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, Copy, Check, Sparkles, ShieldAlert, Activity, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import PasswordInput from '../components/PasswordInput';

const PASSWORD_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';

function generatePassword(length = 14) {
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += PASSWORD_CHARS[buf[i] % PASSWORD_CHARS.length];
  }
  return out;
}

function formatDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString();
}

function AddAdminForm({ onAdded }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  function handleGenerate() {
    setPassword(generatePassword(14));
    setPasswordVisible(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError('Enter an email.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      const res = await api.addAdmin(email.trim(), password);
      setResult({
        email: res.email || email.trim(),
        password,
        existingAccount: !!res.existingAccount,
        alreadyAdmin: !!res.alreadyAdmin,
      });
      setEmail('');
      setPassword('');
      setPasswordVisible(false);
      setCopied(false);
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    const signInUrl = window.location.origin;
    const lines = [
      `Email: ${result.email}`,
      result.existingAccount
        ? '(This account already existed - their existing password still works.)'
        : `Password: ${result.password}`,
      `Sign-in URL: ${signInUrl}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4 space-y-3">
      <div className="text-sm font-medium">Add an admin</div>

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

        <div>
          <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Temporary password</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                visible={passwordVisible}
                onVisibleChange={setPasswordVisible}
              />
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              className="shrink-0 flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40"
            >
              <Sparkles size={14} />
              Generate
            </button>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
            Share this with them securely - the password will only be shown once after the admin is added.
          </p>
        </div>

        {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50"
        >
          <Plus size={14} />
          {busy ? 'Adding…' : 'Add admin'}
        </button>
      </form>

      {result && (
        <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 p-3 space-y-2">
          {result.alreadyAdmin ? (
            <>
              <div className="text-sm font-medium text-[var(--color-success)]">Nothing changed</div>
              <p className="text-xs text-[var(--color-text-muted)] break-words">
                <strong>{result.email}</strong> was already an admin. The typed password was not applied.
              </p>
            </>
          ) : result.existingAccount ? (
            <>
              <div className="text-sm font-medium text-[var(--color-success)]">Admin role granted</div>
              <p className="text-xs text-[var(--color-text-muted)] break-words">
                <strong>{result.email}</strong> already had an account - they're now an admin. Their existing password still
                works; the password you typed was not applied.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy details'}
                </button>
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  Dismiss
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-[var(--color-success)]">Admin added</div>
              <div className="text-xs text-[var(--color-text-muted)] break-all">
                <div><span className="text-[var(--color-text)]">Email:</span> {result.email}</div>
                <div>
                  <span className="text-[var(--color-text)]">Password:</span>{' '}
                  <span className="font-[var(--font-mono)]">{result.password}</span>
                </div>
                <div><span className="text-[var(--color-text)]">Sign-in URL:</span> {window.location.origin}</div>
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                This password is only shown now. If they lose it, they can use "Forgot password?" on the sign-in page.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy details'}
                </button>
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  Dismiss
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AdminRow({ admin, onRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleRemove() {
    if (!window.confirm(`Remove ${admin.email || admin.id} from the admin team?`)) return;
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
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)]">
          Last sign-in: {formatDate(admin.lastSignInAt)}
        </div>
        {error && <div className="text-[11px] text-[var(--color-danger)] mt-1">{error}</div>}
      </div>
      {!admin.isYou && (
        <button
          type="button"
          disabled={busy}
          onClick={handleRemove}
          title="Remove admin"
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

  // One-shot fetch on mount. No polling - this is a diagnostic read, not
  // a live feed. The explicit Refresh button covers "I just exercised the
  // app, show me what landed".
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
      <p className="text-xs text-[var(--color-text-muted)] mb-3">
        Store calls that did not pass a workspace scope, or attempted a cross-workspace write. During Phase 2.3 these are
        logged, not blocked - the goal is to drive this list to zero before enforcement is turned on.
      </p>

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
        Admins can see everything and do everything in this dashboard - only add people you trust.
      </p>

      <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 mb-4 flex items-start gap-2">
        <ShieldAlert size={14} className="shrink-0 mt-0.5 text-[var(--color-warning)]" />
        <div className="text-xs text-[var(--color-text-muted)]">
          A new admin's temporary password is shown once, right after they're added. Share it securely - they can change it
          with "Forgot password?" on the sign-in page.
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

      <div className="mt-6">
        <WorkspaceHealth />
      </div>
    </div>
  );
}
