import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, MessageCircle, Smartphone, Unlink, X, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

/**
 * "WhatsApp (your phone)" - links the signed-in admin's own WhatsApp through
 * WAHA: Connect starts their session, the QR shows in a modal and refreshes
 * until the phone is linked, then the number and a Disconnect button show.
 * With WHATSAPP_PROVIDER=twilio it just shows the Twilio status.
 */
const POLL_MS = 3000;

function formatNumber(n) {
  return n ? `+${n}` : '';
}

/** "Can't scan?" - link with an 8-character code typed into WhatsApp instead. */
function PairingCode({ ready }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function getCode(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setCode('');
    try {
      const r = await api.whatsappPairingCode(phone);
      setCode(r.code);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 w-full text-xs text-[var(--color-accent)] hover:underline">
        Can't scan? Link with a code instead
      </button>
    );
  }
  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-3 space-y-2">
      <div className="text-xs font-medium">Link with a code</div>
      <form onSubmit={getCode} className="flex gap-2">
        <input
          type="tel" inputMode="numeric" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="Your WhatsApp number, e.g. 233201234567"
          className="flex-1 min-w-0 text-sm px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]"
        />
        <button type="submit" disabled={busy || !ready || phone.replace(/\D/g, '').length < 9}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : 'Get code'}
        </button>
      </form>
      {!ready && <p className="text-[11px] text-[var(--color-text-muted)]">Wait for the QR code to appear, then you can ask for a code.</p>}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      {code && (
        <>
          <div className="text-center text-2xl font-[var(--font-mono)] tracking-[0.3em] py-2 select-all">{code}</div>
          <ol className="text-xs text-[var(--color-text-muted)] space-y-1 list-decimal list-inside">
            <li>In WhatsApp, open <strong>Linked devices</strong> → <strong>Link a device</strong>.</li>
            <li>Tap <strong>Link with phone number instead</strong>.</li>
            <li>Type the code above.</li>
          </ol>
        </>
      )}
    </div>
  );
}

export default function WhatsAppConnectCard() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const s = await api.getWhatsappSession();
      setSession(s);
      return s;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // While the QR modal is open, refresh the status (and the QR, which WhatsApp rotates) until linked.
  useEffect(() => {
    if (!qrOpen) return undefined;
    pollRef.current = setInterval(async () => {
      const s = await load();
      if (s?.status === 'WORKING') setQrOpen(false);
    }, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [qrOpen, load]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.startWhatsappSession();
      if (res.warning) setError(res.warning);
      await load();
      setQrOpen(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect WhatsApp? CodeCraft will stop receiving and sending messages from this number.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.disconnectWhatsappSession();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const status = session?.status;
  const linked = status === 'WORKING';
  const isTwilio = session?.provider === 'twilio';

  let badge;
  if (loading) badge = <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]"><Loader2 size={13} className="animate-spin" /> Checking…</span>;
  else if (linked) badge = <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 size={13} /> Connected</span>;
  else if (session?.needsReconnect || status === 'FAILED') badge = <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-danger)]"><AlertCircle size={13} /> Needs reconnect</span>;
  else if (status === 'NOT_AVAILABLE') badge = <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)]"><AlertCircle size={13} /> Not available yet</span>;
  else if (status === 'IN_USE') badge = <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)]"><AlertCircle size={13} /> Connected by another admin</span>;
  else if (status === 'UNREACHABLE') badge = <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-warning)]"><AlertCircle size={13} /> WhatsApp server offline</span>;
  else badge = <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]"><AlertCircle size={13} /> Not connected</span>;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3 mb-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-[var(--color-surface-2)] flex items-center justify-center">
          <MessageCircle size={16} className="text-[var(--color-text-muted)]" />
        </div>
        <div>
          <div className="font-[var(--font-display)] font-semibold text-sm">{isTwilio ? 'WhatsApp (Twilio)' : 'WhatsApp (your phone)'}</div>
          {badge}
        </div>
        <span className="ml-auto text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] border border-[var(--color-border)] rounded px-1.5 py-0.5">
          {isTwilio ? 'Twilio' : 'WAHA'}
        </span>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        {isTwilio
          ? 'Messages go through the Twilio account set on the server.'
          : 'Link your own WhatsApp by scanning a QR code, like WhatsApp Web. Only you see your chats; replies are sent automatically after a safety check.'}
      </p>

      {linked && session?.phoneNumber && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Number: <strong>{formatNumber(session.phoneNumber)}</strong>{session.pushName ? ` (${session.pushName})` : ''}
        </p>
      )}
      {session?.status === 'NOT_CONFIGURED' && (
        <p className="text-xs text-[var(--color-warning)]">
          {isTwilio ? 'Twilio isn’t configured on the server.' : 'The WhatsApp server isn’t set up yet (WAHA_BASE_URL on the backend).'}
        </p>
      )}
      {status === 'UNREACHABLE' && <p className="text-xs text-[var(--color-warning)]">{session.error}</p>}
      {status === 'IN_USE' && <p className="text-xs text-[var(--color-text-muted)]">{session.message}</p>}
      {status === 'NOT_AVAILABLE' && (
        <p className="text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 text-[var(--color-text)]">{session.message}</p>
      )}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

      {!isTwilio && session?.configured && status !== 'IN_USE' && status !== 'NOT_AVAILABLE' && (
        <div className="flex gap-2">
          {linked ? (
            <button
              onClick={disconnect}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/40 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />} Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={busy || status === 'UNREACHABLE'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-accent)] text-black hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Smartphone size={13} />}
              {session?.needsReconnect || status === 'FAILED' ? 'Reconnect WhatsApp' : 'Connect WhatsApp'}
            </button>
          )}
          {status === 'UNREACHABLE' && (
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <RefreshCw size={13} /> Retry
            </button>
          )}
        </div>
      )}

      {qrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setQrOpen(false)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-xl w-full max-w-sm mx-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold font-[var(--font-display)]">Scan with WhatsApp</h3>
              <button onClick={() => setQrOpen(false)} className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>
            </div>
            <ol className="text-xs text-[var(--color-text-muted)] space-y-1 mb-4 list-decimal list-inside">
              <li>Open WhatsApp on your phone.</li>
              <li>Tap <strong>Settings</strong> (iPhone) or <strong>⋮ menu</strong> (Android) → <strong>Linked devices</strong>.</li>
              <li>Tap <strong>Link a device</strong> and point the camera at this code.</li>
            </ol>
            <div className="flex items-center justify-center rounded-lg bg-white p-3 min-h-[240px]">
              {session?.qr ? (
                <img src={session.qr} alt="WhatsApp QR code" className="w-56 h-56" />
              ) : session?.status === 'WORKING' ? (
                <span className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 size={16} /> Linked</span>
              ) : (
                <span className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Preparing QR code…</span>
              )}
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-3 text-center">
              The code refreshes automatically. This window closes once your phone is linked.
            </p>
            <PairingCode ready={session?.status === 'SCAN_QR_CODE'} />
          </div>
        </div>
      )}
    </div>
  );
}
