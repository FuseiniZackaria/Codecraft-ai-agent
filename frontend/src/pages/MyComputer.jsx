import { useEffect, useRef, useState } from 'react';
import {
  Monitor, Download, Pause, Play, Unplug, RefreshCw, Copy, Check, Folder, AppWindow,
  ShieldCheck, Loader2, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { api } from '../services/api';

/**
 * "My computer" - each person connects THEIR OWN computer so the AI can
 * search, open and (with their approval) move files to the Recycle Bin there.
 * Only their own requests ever reach it - nobody else, not even the owner.
 */

const RUN_CMD = 'node codecraft-computer-helper.js';

function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {});
      }}
      className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 shrink-0"
    >
      {done ? <Check size={11} /> : <Copy size={11} />}
      {done ? 'Copied' : label}
    </button>
  );
}

async function downloadHelper(code) {
  const { filename, content } = await api.getComputerHelper(code);
  const url = URL.createObjectURL(new Blob([content], { type: 'text/javascript' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StatusIcon({ status }) {
  if (status === 'done') return <CheckCircle2 size={13} className="text-[var(--color-success)] shrink-0" />;
  if (status === 'failed' || status === 'expired') return <XCircle size={13} className="text-[var(--color-danger)] shrink-0" />;
  return <Clock size={13} className="text-[var(--color-text-muted)] shrink-0" />;
}

export default function MyComputer() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState(null); // { code, expiresAt }
  const timer = useRef(null);

  async function load() {
    try {
      const d = await api.getMyComputer();
      setData(d);
      setError(null);
      if (d.devices?.some((x) => x.status === 'active')) setPairing(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  // While a connect code is showing, check every 4 s for the helper to connect.
  useEffect(() => {
    clearInterval(timer.current);
    if (pairing) timer.current = setInterval(load, 4000);
    return () => clearInterval(timer.current);
  }, [pairing]);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const device = data?.devices?.find((d) => d.status === 'active') || null;
  const codeExpired = pairing && new Date(pairing.expiresAt).getTime() < Date.now();

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <Monitor size={20} className="text-[var(--color-accent)] shrink-0" />
        <h1 className="font-[var(--font-display)] text-xl font-semibold truncate">My computer</h1>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Let the AI find, open and - only with your approval - move files to the Recycle Bin on your own computer.
      </p>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-muted)]">
        <ShieldCheck size={15} className="text-[var(--color-success)] shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <div>Only <b>your</b> requests reach your computer. Nobody else in this app - not even the owner - can use it or see what is on it.</div>
          <div>The AI only sees the folders you pick on your PC. Programs and scripts are never opened, and nothing is deleted without your approval on the Tasks page (it goes to the Recycle Bin, so you can restore it).</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-xs text-[var(--color-danger)] break-words">{error}</div>
      )}

      {!data && !error && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      )}

      {data && device && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4">
          <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-2 w-2 rounded-full shrink-0 ${device.paused ? 'bg-[var(--color-warning)]' : device.online ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'}`} />
                <span className="font-medium truncate">{device.name}</span>
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {device.paused ? 'Paused - the AI can\'t use it until you resume' : device.online ? 'Connected and ready' : `Helper not running (last seen ${timeAgo(device.last_seen_at)})`}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => api.pauseMyComputer(device.id, !device.paused))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] hover:text-[var(--color-accent)] disabled:opacity-50"
              >
                {device.paused ? <Play size={12} /> : <Pause size={12} />}
                {device.paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => window.confirm('Disconnect this computer? The AI stops using it right away. To use it again you will connect it with a new code.') && run(() => api.disconnectMyComputer(device.id))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] hover:text-[var(--color-danger)] disabled:opacity-50"
              >
                <Unplug size={12} /> Disconnect
              </button>
            </div>
          </div>

          <div className="text-xs font-medium mb-1">Shared folders</div>
          {device.roots.length ? (
            <ul className="space-y-1 mb-3">
              {device.roots.map((r) => (
                <li key={r} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] min-w-0">
                  <Folder size={12} className="shrink-0" /> <span className="break-all">{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-[var(--color-text-muted)] mb-3">None reported yet.</div>
          )}

          <div className="text-xs font-medium mb-1">Apps it may start</div>
          <div className="text-xs text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5 flex-wrap">
            <AppWindow size={12} className="shrink-0" />
            {device.apps.length ? device.apps.join(', ') : 'None'}
          </div>

          <p className="text-[11px] text-[var(--color-text-muted)]">
            To change folders or apps, run <code className="font-[var(--font-mono)] break-all">{RUN_CMD} --change-folders</code> on your PC. The website can show this list but can never change it.
          </p>
        </div>
      )}

      {data && !device && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4">
          <div className="text-sm font-medium mb-3">Connect this computer</div>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-2">
              <span className="text-[var(--color-accent)] font-semibold shrink-0">1.</span>
              <div className="min-w-0">
                Install <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-[var(--color-accent)] underline">Node.js</a> (version 18 or newer) on the computer you want to connect, if it isn't there already.
              </div>
            </li>
            <li className="flex gap-2">
              <span className="text-[var(--color-accent)] font-semibold shrink-0">2.</span>
              <div className="min-w-0 flex-1">
                <div className="mb-2">Get a connect code and download the helper (the code is built in).</div>
                {!pairing || codeExpired ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(async () => {
                      const p = await api.connectMyComputer();
                      setPairing({ code: p.code, expiresAt: p.expiresAt });
                      await downloadHelper(p.code);
                    })}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm bg-[var(--color-accent)] text-white disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {codeExpired ? 'Code expired - get a new one' : 'Get code & download helper'}
                  </button>
                ) : (
                  <div className="rounded-md border border-[var(--color-border)] p-3">
                    <div className="text-xs text-[var(--color-text-muted)] mb-1">Your connect code (works once, for 10 minutes)</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-[var(--font-mono)] text-xl tracking-widest">{pairing.code}</span>
                      <CopyButton text={pairing.code} />
                      <button
                        type="button"
                        onClick={() => run(() => downloadHelper(pairing.code))}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                      >
                        <Download size={11} /> Download again
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </li>
            <li className="flex gap-2">
              <span className="text-[var(--color-accent)] font-semibold shrink-0">3.</span>
              <div className="min-w-0 flex-1">
                <div className="mb-2">Open a terminal in your Downloads folder and run:</div>
                <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-black/30 px-3 py-2">
                  <code className="font-[var(--font-mono)] text-xs flex-1 break-all">{RUN_CMD}</code>
                  <CopyButton text={RUN_CMD} />
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-1">
                  On Windows: open Downloads, click the address bar, type <code className="font-[var(--font-mono)]">cmd</code>, press Enter, then paste the line above.
                </div>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="text-[var(--color-accent)] font-semibold shrink-0">4.</span>
              <div className="min-w-0">Pick the folders the AI may look at. Keep the helper window open while you want the AI to reach your computer.</div>
            </li>
          </ol>
          {pairing && !codeExpired && (
            <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 size={12} className="animate-spin" /> Waiting for your computer to connect…
            </div>
          )}
        </div>
      )}

      {data && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-sm font-medium">What the AI did on your computer</div>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 shrink-0"
            >
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
          {data.recent?.length ? (
            <ul className="divide-y divide-[var(--color-border)]">
              {data.recent.map((j) => (
                <li key={j.id} className="flex items-start gap-2 py-2 text-xs min-w-0">
                  <StatusIcon status={j.status} />
                  <div className="min-w-0 flex-1">
                    <div className="break-all">{j.summary}</div>
                    {j.error && <div className="text-[var(--color-danger)] break-words">{j.error}</div>}
                  </div>
                  <span className="text-[var(--color-text-muted)] shrink-0">{timeAgo(j.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-[var(--color-text-muted)]">Nothing yet. Try asking Ian: "find my biggest files".</div>
          )}
        </div>
      )}
    </div>
  );
}
