import { useState } from 'react';
import { LogIn, Mail, KeyRound } from 'lucide-react';
import Logo from '../components/Logo';
import PasswordInput from '../components/PasswordInput';
import { supabase } from '../services/supabaseClient';

export default function Login() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'forgot' | 'code'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [resetSent, setResetSent] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');

  // Email code sign-in: Supabase emails a one-time code. shouldCreateUser:false
  // means only existing (invited) accounts can sign in this way - it never
  // creates new accounts.
  async function handleSendCode(e) {
    e?.preventDefault();
    if (!email.trim()) return setError('Enter your email first.');
    setBusy(true);
    setError(null);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });
      if (otpError) {
        // Don't reveal whether an account exists.
        if (/signups? not allowed|user not found/i.test(otpError.message || '')) {
          setCodeSent(true);
          return;
        }
        throw otpError;
      }
      setCodeSent(true);
    } catch (err) {
      setError(/rate limit|too many/i.test(err.message || '')
        ? 'Too many codes requested. Wait a minute and try again.'
        : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault();
    const token = code.replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(token)) return setError('Enter the code from the email.');
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
      if (verifyError) throw verifyError;
      // App.jsx picks up the new session via onAuthStateChange.
    } catch (err) {
      setError(/expired|invalid/i.test(err.message || '')
        ? 'That code is wrong or has expired. Check the latest email or send a new code.'
        : err.message);
    } finally {
      setBusy(false);
    }
  }

  function backToSignIn() {
    setMode('signin');
    setError(null);
    setCodeSent(false);
    setCode('');
  }


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
    <div className="min-h-dvh flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)] font-[var(--font-body)] px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Logo />
          <span className="font-[var(--font-display)] font-semibold tracking-tight text-xl">
            CodeCraft
          </span>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          {mode === 'code' ? (
            <>
              <h1 className="font-[var(--font-display)] text-lg font-semibold mb-1">Sign in with an email code</h1>
              {!codeSent ? (
                <>
                  <p className="text-sm text-[var(--color-text-muted)] mb-6">
                    We'll email you a one-time code. No password needed.
                  </p>
                  <form onSubmit={handleSendCode} className="space-y-3">
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoFocus
                        autoComplete="email"
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
                      {busy ? 'Sending…' : 'Send code'}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--color-text-muted)] mb-6">
                    If <strong>{email.trim()}</strong> has an account, a code is on its way. Enter it below.
                  </p>
                  <form onSubmit={handleVerifyCode} className="space-y-3">
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Code</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))}
                        placeholder="123456"
                        maxLength={12}
                        autoFocus
                        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-lg tracking-[0.4em] text-center font-[var(--font-mono)] outline-none focus:border-[var(--color-accent)]/50"
                      />
                    </div>
                    {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50 mt-2"
                    >
                      <LogIn size={14} />
                      {busy ? 'Checking…' : 'Sign in'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { setCode(''); handleSendCode(); }}
                      className="w-full text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] pt-1"
                    >
                      Send a new code
                    </button>
                  </form>
                </>
              )}
              <button
                type="button"
                onClick={backToSignIn}
                className="w-full text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] pt-2"
              >
                ← Sign in with password instead
              </button>
            </>
          ) : mode === 'forgot' ? (
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
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
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

          <div className="flex items-center gap-2 my-4 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            <span className="flex-1 h-px bg-[var(--color-border)]" /> or <span className="flex-1 h-px bg-[var(--color-border)]" />
          </div>
          <button
            type="button"
            onClick={() => { setMode('code'); setError(null); setCodeSent(false); setCode(''); }}
            className="w-full flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-accent)]/50"
          >
            <KeyRound size={14} />
            Sign in with an email code
          </button>
          </>
          )}
        </div>

        <p className="text-center text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)] mt-6">          Build. Automate. Scale.
        </p>
      </div>
    </div>
  );
}