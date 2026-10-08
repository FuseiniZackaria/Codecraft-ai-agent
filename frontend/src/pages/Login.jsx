import { useState } from 'react';
import { LogIn, Mail } from 'lucide-react';
import Logo from '../components/Logo';
import { supabase } from '../services/supabaseClient';

export default function Login() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [resetSent, setResetSent] = useState(false);


    async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Enter both email and password.');
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw signInError;
      // No manual redirect/state update needed here - App.jsx listens for
      // Supabase's onAuthStateChange and re-renders once the session lands.
    } catch (err) {
      setError(err.message === 'Invalid login credentials' ? 'Incorrect email or password.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your email first.');
    setBusy(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) throw resetError;
      setResetSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }



  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)] font-[var(--font-body)] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Logo />
          <span className="font-[var(--font-display)] font-semibold tracking-tight text-xl">
            CodeCraft
          </span>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
                    {mode === 'forgot' ? (
            resetSent ? (
              <>
                <h1 className="font-[var(--font-display)] text-lg font-semibold mb-1">Check your email</h1>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">
                  If an account exists for <strong>{email.trim()}</strong>, a password reset link is on its way.
                </p>
                <button
                  type="button"
                  onClick={() => { setMode('signin'); setResetSent(false); }}
                  className="text-xs text-[var(--color-accent)]"
                >
                  ← Back to sign in
                </button>
              </>
            ) : (
              <>
                <h1 className="font-[var(--font-display)] text-lg font-semibold mb-1">Reset your password</h1>
                <p className="text-sm text-[var(--color-text-muted)] mb-6">
                  Enter your email and we'll send you a reset link.
                </p>
                <form onSubmit={handleForgotPassword} className="space-y-3">
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoFocus
                      className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm outline-none focus:border-[var(--color-accent)]/50"
                    />
                  </div>
                  {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50 mt-2"
                  >
                    <Mail size={14} />
                    {busy ? 'Sending…' : 'Send reset link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('signin'); setError(null); }}
                    className="w-full text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] pt-1"
                  >
                    ← Back to sign in
                  </button>
                </form>
              </>
            )
          ) : (
          <>
          <h1 className="font-[var(--font-display)] text-lg font-semibold mb-1">Sign in</h1>
          <p className="text-sm text-[var(--color-text-muted)] mb-6">
            Enter your credentials to access your dashboard.
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm outline-none focus:border-[var(--color-accent)]/50"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm outline-none focus:border-[var(--color-accent)]/50"
              />
            </div>

            {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}

                        <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50 mt-2"
            >
              <LogIn size={14} />
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={() => { setMode('forgot'); setError(null); setResetSent(false); }}
              className="w-full text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] pt-1"
            >
              Forgot password?
            </button>
                    </form>
          </>
          )}
        </div>

        <p className="text-center text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)] mt-6">          Build. Automate. Scale.
        </p>
      </div>
    </div>
  );
}