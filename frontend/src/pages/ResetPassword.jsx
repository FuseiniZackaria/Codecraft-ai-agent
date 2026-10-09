import { useState, useEffect } from 'react';
import { KeyRound, AlertTriangle } from 'lucide-react';
import Logo from '../components/Logo';
import PasswordInput from '../components/PasswordInput';
import { supabase } from '../services/supabaseClient';

/**
 * Reached two ways:
 *  1. Valid reset link  → Supabase fires PASSWORD_RECOVERY, App.jsx sets
 *     passwordRecovery=true, session is established → show the set-password form.
 *  2. Expired/invalid link → hash contains #error=access_denied — no session,
 *     App.jsx routes here by path so the user sees a clear error instead of
 *     silently landing on the Login page.
 */
export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);

  // Parse hash fragment on mount - Supabase puts errors here when the OTP
  // has expired or been used already: #error=access_denied&error_code=otp_expired&...
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.get('error')) {
      const desc = params.get('error_description') || 'This link is invalid or has expired.';
      setLinkExpired(true);
      setError(decodeURIComponent(desc.replace(/\+/g, ' ')));
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords don\'t match.');
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
      // Sign out the recovery session and redirect to login after a brief moment
      // so the user sees the confirmation before being taken back.
      setTimeout(async () => {
        await supabase.auth.signOut();
        window.location.href = '/';
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)] font-[var(--font-body)] px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Logo />
          <span className="font-[var(--font-display)] font-semibold tracking-tight text-xl">
            CodeCraft
          </span>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          {linkExpired ? (
            <>
              <div className="flex items-center gap-2 mb-3 text-[var(--color-danger)]">
                <AlertTriangle size={18} />
                <h1 className="font-[var(--font-display)] text-lg font-semibold">Link expired</h1>
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mb-5">
                {error || 'This password reset link has expired or already been used.'}
                {' '}Reset links are valid for 1 hour — request a fresh one below.
              </p>
              <a
                href="/"
                className="w-full flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110"
              >
                Request a new reset link
              </a>
            </>
          ) : done ? (
            <>
              <h1 className="font-[var(--font-display)] text-lg font-semibold mb-1">Password updated</h1>
              <p className="text-sm text-[var(--color-text-muted)]">
                Taking you back to sign in…
              </p>
            </>
          ) : (
            <>
              <h1 className="font-[var(--font-display)] text-lg font-semibold mb-1">Set a new password</h1>
              <p className="text-sm text-[var(--color-text-muted)] mb-6">Choose a new password for your account.</p>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">New password</label>
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoFocus
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Confirm new password</label>
                  <PasswordInput
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>

                {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50 mt-2"
                >
                  <KeyRound size={14} />
                  {busy ? 'Updating…' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
