import { useCallback, useEffect, useState } from 'react';
import {
  Mail, GitBranch, Calendar, MessageCircle, CheckCircle2, XCircle,
  AlertCircle, Loader2, RefreshCw, Link2, Unlink, Send, X, ChevronRight,
  Copy, ExternalLink,
} from 'lucide-react';
import { api } from '../services/api';

const PROVIDERS = [
  { key: 'gmail',          label: 'Gmail',           icon: Mail,           composio: true,  desc: 'Read and send email on your behalf.' },
  { key: 'googlecalendar', label: 'Google Calendar',  icon: Calendar,       composio: true,  desc: 'Check availability and book calls.' },
  { key: 'github',         label: 'GitHub',           icon: GitBranch,      composio: true,  desc: 'Create repos, commit files, open PRs.' },
  { key: 'telegram',       label: 'Telegram',         icon: MessageCircle,  composio: false, desc: 'Receive and reply to Telegram messages.' },
  { key: 'whatsapp',       label: 'WhatsApp',         icon: MessageCircle,  composio: false, desc: 'Receive and reply to WhatsApp messages.' },
];

function StatusBadge({ status }) {
  if (status === 'connected') return <span className="flex items-center gap-1 text-xs font-medium text-emerald-500"><CheckCircle2 size={13} /> Connected</span>;
  if (status === 'failed') return <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-danger)]"><XCircle size={13} /> Error</span>;
  return <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]"><AlertCircle size={13} /> Not connected</span>;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
      title="Copy"
    >
      {copied ? <CheckCircle2 size={13} className="text-emerald-500" /> : <Copy size={13} />}
    </button>
  );
}

// ======================== TELEGRAM WIZARD ========================

function TelegramWizard({ onClose, onConnected }) {
  const [step, setStep] = useState(1);
  const [botToken, setBotToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function handleConnect() {
    setBusy(true); setError(null);
    try {
      const res = await api.connectTelegram(botToken.trim());
      if (res.error) throw new Error(res.error);
      setResult(res);
      setStep(4);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  return (
    <Modal title="Connect Telegram Bot" onClose={onClose}>
      {step === 1 && (
        <div className="space-y-4">
          <Step n={1} active>Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-[var(--color-accent)] underline">@BotFather</a> in Telegram.</Step>
          <Step n={2}>Send <code className="px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-xs font-[var(--font-mono)]">/newbot</code> and follow the prompts to create a new bot.</Step>
          <Step n={3}>BotFather gives you an <strong>API token</strong> that looks like <code className="text-xs font-[var(--font-mono)]">123456:ABC-DEF1234...</code></Step>
          <button onClick={() => setStep(2)} className={`${BTN_PRIMARY} w-full`}>I have my token <ChevronRight size={14} /></button>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <label className="text-sm font-medium text-[var(--color-text)]">Paste your bot token</label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            className={`${INPUT_FIELD} w-full font-[var(--font-mono)]`}
            autoFocus
          />
          <p className="text-xs text-[var(--color-text-muted)]">Your token is encrypted before storage and never shown again.</p>
          {error && <ErrorMsg>{error}</ErrorMsg>}
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className={`${BTN_SECONDARY} flex-1`}>Back</button>
            <button onClick={handleConnect} disabled={busy || !botToken.includes(':')} className={`${BTN_PRIMARY} flex-1`}>
              {busy ? <><Loader2 size={14} className="animate-spin" /> Verifying...</> : 'Connect'}
            </button>
          </div>
        </div>
      )}
      {step === 4 && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-500 font-medium"><CheckCircle2 size={16} /> Connected!</div>
          <p className="text-sm text-[var(--color-text-muted)]">Bot <strong>@{result.botUsername}</strong> is live and receiving messages.</p>
          <p className="text-xs text-[var(--color-text-muted)]">The webhook was registered automatically. To test it, send a message to your bot in Telegram.</p>
          <button onClick={() => { onConnected(); onClose(); }} className={`${BTN_PRIMARY} w-full`}>Done</button>
        </div>
      )}
    </Modal>
  );
}

// ======================== WHATSAPP WIZARD ========================

function WhatsAppWizard({ onClose, onConnected }) {
  const [tab, setTab] = useState('meta');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Meta fields
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');

  // Twilio fields
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [whatsappFrom, setWhatsappFrom] = useState('');

  async function handleConnect() {
    setBusy(true); setError(null);
    try {
      let res;
      if (tab === 'meta') {
        res = await api.connectWhatsApp({ provider: 'meta', phoneNumberId, accessToken });
      } else {
        res = await api.connectWhatsApp({ provider: 'twilio', accountSid, authToken, whatsappFrom: whatsappFrom || undefined });
      }
      if (res.error) throw new Error(res.error);
      setResult(res);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  if (result) {
    return (
      <Modal title="WhatsApp Connected" onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-500 font-medium"><CheckCircle2 size={16} /> Connected!</div>
          {result.webhookUrl && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Webhook URL (paste into {tab === 'meta' ? 'Meta Developer Console' : 'Twilio Console'})</label>
              <div className="flex items-center gap-1 bg-[var(--color-surface-2)] rounded-md px-3 py-2">
                <code className="text-xs font-[var(--font-mono)] flex-1 break-all">{result.webhookUrl}</code>
                <CopyButton text={result.webhookUrl} />
              </div>
            </div>
          )}
          {result.webhookVerifyToken && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Verify Token (paste into Meta webhook config)</label>
              <div className="flex items-center gap-1 bg-[var(--color-surface-2)] rounded-md px-3 py-2">
                <code className="text-xs font-[var(--font-mono)] flex-1 break-all">{result.webhookVerifyToken}</code>
                <CopyButton text={result.webhookVerifyToken} />
              </div>
            </div>
          )}
          <button onClick={() => { onConnected(); onClose(); }} className={`${BTN_PRIMARY} w-full`}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Connect WhatsApp" onClose={onClose}>
      <div className="flex gap-1 mb-4 bg-[var(--color-surface-2)] rounded-md p-0.5">
        <button onClick={() => setTab('meta')} className={`flex-1 text-xs py-1.5 rounded ${tab === 'meta' ? 'bg-[var(--color-surface)] shadow-sm font-medium' : 'text-[var(--color-text-muted)]'}`}>
          Meta Cloud API
        </button>
        <button onClick={() => setTab('twilio')} className={`flex-1 text-xs py-1.5 rounded ${tab === 'twilio' ? 'bg-[var(--color-surface)] shadow-sm font-medium' : 'text-[var(--color-text-muted)]'}`}>
          Twilio
        </button>
      </div>

      {tab === 'meta' ? (
        <div className="space-y-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            Create a Meta developer app, add WhatsApp, then paste the Phone Number ID and Access Token from the API Setup page.
          </p>
          <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">
            Open Meta Developer Console <ExternalLink size={11} />
          </a>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Phone Number ID</label>
            <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} className={`${INPUT_FIELD} w-full mt-1`} placeholder="e.g. 123456789012345" />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Permanent Access Token</label>
            <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} className={`${INPUT_FIELD} w-full mt-1`} placeholder="EAA..." />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            Get your Account SID and Auth Token from the Twilio Console. The sandbox number works immediately with no business verification.
          </p>
          <a href="https://console.twilio.com" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">
            Open Twilio Console <ExternalLink size={11} />
          </a>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Account SID</label>
            <input value={accountSid} onChange={(e) => setAccountSid(e.target.value)} className={`${INPUT_FIELD} w-full mt-1`} placeholder="AC..." />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Auth Token</label>
            <input type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} className={`${INPUT_FIELD} w-full mt-1`} placeholder="Your auth token" />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)]">WhatsApp From (optional)</label>
            <input value={whatsappFrom} onChange={(e) => setWhatsappFrom(e.target.value)} className={`${INPUT_FIELD} w-full mt-1`} placeholder="whatsapp:+14155238886 (sandbox default)" />
          </div>
        </div>
      )}

      {error && <ErrorMsg>{error}</ErrorMsg>}
      <div className="flex gap-2 mt-4">
        <button onClick={onClose} className={`${BTN_SECONDARY} flex-1`}>Cancel</button>
        <button
          onClick={handleConnect}
          disabled={busy || (tab === 'meta' ? !phoneNumberId || !accessToken : !accountSid || !authToken)}
          className={`${BTN_PRIMARY} flex-1`}
        >
          {busy ? <><Loader2 size={14} className="animate-spin" /> Verifying...</> : 'Connect'}
        </button>
      </div>
    </Modal>
  );
}

// ======================== COMPOSIO WIZARD ========================

function ComposioWizard({ provider, label, onClose, onConnected }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null); // 'redirected' | 'checking' | 'connected'
  const [connectionId, setConnectionId] = useState(null);

  async function handleInitiate() {
    setBusy(true); setError(null);
    try {
      const res = await api.connectComposio(provider);
      if (res.error) throw new Error(res.error);
      if (res.adopted) {
        setStatus('connected');
        setBusy(false);
        return;
      }
      if (res.redirectUrl) {
        setConnectionId(res.connectionId);
        window.open(res.redirectUrl, '_blank');
        setStatus('redirected');
      } else if (res.dashboardUrl) {
        window.open(res.dashboardUrl, '_blank');
        setStatus('redirected');
      }
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  async function handleCheck() {
    setStatus('checking'); setError(null);
    try {
      const res = await api.checkComposio(provider, connectionId);
      if (res.ok) {
        setStatus('connected');
      } else {
        setError(`Status: ${res.status || 'not connected yet'}. Complete the authorization in the popup, then try again.`);
        setStatus('redirected');
      }
    } catch (err) { setError(err.message); setStatus('redirected'); }
  }

  return (
    <Modal title={`Connect ${label}`} onClose={onClose}>
      {status === 'connected' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-500 font-medium"><CheckCircle2 size={16} /> {label} connected!</div>
          <button onClick={() => { onConnected(); onClose(); }} className={`${BTN_PRIMARY} w-full`}>Done</button>
        </div>
      ) : status === 'redirected' || status === 'checking' ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Complete the authorization in the window that opened. When done, click below to verify.
          </p>
          {error && <ErrorMsg>{error}</ErrorMsg>}
          <button onClick={handleCheck} disabled={status === 'checking'} className={`${BTN_PRIMARY} w-full`}>
            {status === 'checking' ? <><Loader2 size={14} className="animate-spin" /> Checking...</> : 'I completed authorization'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Click Connect to open {label}'s authorization flow. You'll sign in with your {label} account and grant CodeCraft access.
          </p>
          {error && <ErrorMsg>{error}</ErrorMsg>}
          <button onClick={handleInitiate} disabled={busy} className={`${BTN_PRIMARY} w-full`}>
            {busy ? <><Loader2 size={14} className="animate-spin" /> Starting...</> : <><Link2 size={14} /> Connect {label}</>}
          </button>
        </div>
      )}
    </Modal>
  );
}

// ======================== TEST DIALOG ========================

function TestDialog({ provider, providerLabel, onClose }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(false);

  async function handleTest() {
    setBusy(true); setError(null);
    try {
      let res;
      if (provider === 'telegram') {
        res = await api.testTelegram(input.trim());
      } else {
        res = await api.testWhatsApp(input.trim());
      }
      if (res.error) throw new Error(res.error);
      setOk(true);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  return (
    <Modal title={`Test ${providerLabel}`} onClose={onClose}>
      {ok ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-500 font-medium"><CheckCircle2 size={16} /> Message sent!</div>
          <p className="text-sm text-[var(--color-text-muted)]">Check your {providerLabel} for the test message.</p>
          <button onClick={onClose} className={`${BTN_PRIMARY} w-full`}>Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="text-sm font-medium text-[var(--color-text)]">
            {provider === 'telegram' ? 'Your Telegram chat ID' : 'Your WhatsApp number'}
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className={`${INPUT_FIELD} w-full`}
            placeholder={provider === 'telegram' ? 'e.g. 123456789' : 'e.g. +233501234567'}
            autoFocus
          />
          <p className="text-xs text-[var(--color-text-muted)]">
            {provider === 'telegram'
              ? 'Send /start to your bot first, then send any message. Use @userinfobot to find your chat ID.'
              : 'The test message is sent only to this number.'}
          </p>
          {error && <ErrorMsg>{error}</ErrorMsg>}
          <div className="flex gap-2">
            <button onClick={onClose} className={`${BTN_SECONDARY} flex-1`}>Cancel</button>
            <button onClick={handleTest} disabled={busy || !input.trim()} className={`${BTN_PRIMARY} flex-1`}>
              {busy ? <><Loader2 size={14} className="animate-spin" /> Sending...</> : <><Send size={14} /> Send test</>}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ======================== SHARED COMPONENTS ========================

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-xl w-full max-w-md mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold font-[var(--font-display)]">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Step({ n, active, children }) {
  return (
    <div className={`flex gap-3 ${active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>
      <span className="w-5 h-5 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{n}</span>
      <p className="text-sm">{children}</p>
    </div>
  );
}

function ErrorMsg({ children }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-md text-sm text-[var(--color-danger)]">
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      <span className="break-words">{children}</span>
    </div>
  );
}

const BTN_PRIMARY = 'px-3 py-2 text-sm bg-[var(--color-accent)] text-black rounded-md hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5 font-medium';
const BTN_SECONDARY = 'px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-3)] flex items-center justify-center gap-1.5 disabled:opacity-50';
const BTN_DANGER = 'px-3 py-2 text-sm border border-[var(--color-danger)]/30 text-[var(--color-danger)] rounded-md hover:bg-[var(--color-danger)]/10 flex items-center justify-center gap-1.5 disabled:opacity-50';
const INPUT_FIELD = 'px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)]';

// ======================== MAIN PAGE ========================

export default function Connections() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [wizard, setWizard] = useState(null); // { type: 'telegram' | 'whatsapp' | 'composio', provider?, label? }
  const [testDialog, setTestDialog] = useState(null); // { provider, label }
  const [disconnecting, setDisconnecting] = useState(null);

  const load = useCallback(async (showSpinner) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await api.listConnections();
      setData(res.connections || {});
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  async function handleDisconnect(provider) {
    setDisconnecting(provider);
    try {
      if (provider === 'telegram') await api.disconnectTelegram();
      else if (provider === 'whatsapp') await api.disconnectWhatsApp();
      else await api.disconnectProvider(provider);
      await load(false);
    } catch { /* ignore */ }
    setDisconnecting(null);
  }

  function openWizard(providerDef) {
    if (providerDef.composio) {
      setWizard({ type: 'composio', provider: providerDef.key, label: providerDef.label });
    } else if (providerDef.key === 'telegram') {
      setWizard({ type: 'telegram' });
    } else if (providerDef.key === 'whatsapp') {
      setWizard({ type: 'whatsapp' });
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-[var(--color-text-muted)]">Loading connections...</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-[var(--font-display)] font-semibold">Connections</h1>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 disabled:opacity-50"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Checking...' : 'Refresh'}
        </button>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Connect your accounts so agents can send messages, read email, and manage your calendar.
        Each workspace has its own connections.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        {PROVIDERS.map((p) => {
          const conn = data?.[p.key] || { status: 'not_connected' };
          const isConnected = conn.status === 'connected';
          const Icon = p.icon;
          return (
            <div key={p.key} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-[var(--color-surface-2)] flex items-center justify-center">
                  <Icon size={16} className="text-[var(--color-text-muted)]" />
                </div>
                <div>
                  <div className="font-[var(--font-display)] font-semibold text-sm">{p.label}</div>
                  <StatusBadge status={conn.status} />
                </div>
                <span className="ml-auto text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] border border-[var(--color-border)] rounded px-1.5 py-0.5">
                  {p.composio ? 'via Composio' : p.key === 'telegram' ? 'Bot API' : 'Direct'}
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] flex-1">{p.desc}</p>

              {isConnected && p.composio && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Account: <strong>{conn.connected_email || 'connected (address unavailable)'}</strong>
                </p>
              )}
              {isConnected && conn.bot_username && (
                <p className="text-xs text-[var(--color-text-muted)]">Bot: <strong>@{conn.bot_username}</strong></p>
              )}
              {isConnected && conn.display_phone && (
                <p className="text-xs text-[var(--color-text-muted)]">Number: <strong>{conn.display_phone}</strong></p>
              )}
              {isConnected && conn.type && (
                <p className="text-xs text-[var(--color-text-muted)]">Provider: <strong>{conn.type}</strong></p>
              )}
              {isConnected && conn.webhook_url && (
                <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-2)] rounded px-2 py-1.5">
                  <span className="truncate font-[var(--font-mono)]">{conn.webhook_url}</span>
                  <CopyButton text={conn.webhook_url} />
                </div>
              )}

              <div className="flex gap-2 mt-auto">
                {!isConnected ? (
                  <button onClick={() => openWizard(p)} className={`${BTN_PRIMARY} text-xs flex-1`}>
                    <Link2 size={13} /> Connect
                  </button>
                ) : (
                  <>
                    {(p.key === 'telegram' || p.key === 'whatsapp') && (
                      <button onClick={() => setTestDialog({ provider: p.key, label: p.label })} className={`${BTN_SECONDARY} text-xs flex-1`}>
                        <Send size={13} /> Test
                      </button>
                    )}
                    <button
                      onClick={() => handleDisconnect(p.key)}
                      disabled={disconnecting === p.key}
                      className={`${BTN_DANGER} text-xs flex-1`}
                    >
                      {disconnecting === p.key ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {wizard?.type === 'telegram' && <TelegramWizard onClose={() => setWizard(null)} onConnected={() => load(false)} />}
      {wizard?.type === 'whatsapp' && <WhatsAppWizard onClose={() => setWizard(null)} onConnected={() => load(false)} />}
      {wizard?.type === 'composio' && (
        <ComposioWizard provider={wizard.provider} label={wizard.label} onClose={() => setWizard(null)} onConnected={() => load(false)} />
      )}
      {testDialog && <TestDialog provider={testDialog.provider} providerLabel={testDialog.label} onClose={() => setTestDialog(null)} />}
    </div>
  );
}
