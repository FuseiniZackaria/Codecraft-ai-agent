import { useEffect, useState } from 'react';
import { Mail, MessageCircle, MessageSquare, GitBranch, Calendar, Hash, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { useStore } from '../store/useStore';

const CATALOG = [
  { name: 'Slack', icon: Hash, desc: 'Post and read messages in channels.' },
];

function ComposioCard({ icon: Icon, name, desc, toolPrefix, connectedKey, viaLabel = 'via Composio', manageUrl = 'https://app.composio.dev', manageLabel = 'Manage in Composio' }) {
  const store = useStore();
  const loaded = store.summary.installedTools.some((t) => t.startsWith(`${toolPrefix}.`));
  const isConnected = store[connectedKey];

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-[var(--color-surface-2)] flex items-center justify-center">
          <Icon size={16} className="text-[var(--color-text-muted)]" />
        </div>
        <div className="font-[var(--font-display)] font-semibold text-sm">{name}</div>
        <span className="ml-auto text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] border border-[var(--color-border)] rounded px-1.5 py-0.5">
          {viaLabel}
        </span>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] flex-1">{desc}</p>

      {!store.connected || !loaded ? (
        <span className="text-xs text-[var(--color-text-muted)]">Backend not reachable</span>
      ) : isConnected ? (
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-success)]">
          <CheckCircle2 size={14} /> Connected
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-[var(--color-warning)]">Not connected</div>
          
          <a
            href={manageUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline w-fit"
          >
            {manageLabel} <ExternalLink size={11} />
          </a>
        </div>
      )}
    </div>
  );
}

export default function Plugins() {
  const { summary } = useStore();
  const refreshConnectors = useStore((s) => s.refreshConnectors);
  const connectorsLastFetchedAt = useStore((s) => s.connectorsLastFetchedAt);
  const [busy, setBusy] = useState(false);
  const installed = new Set(summary.installedTools.map((t) => t.split('.')[0]));

  // Connector status is fetched here, not in the admin shell. Store has a
  // 5-minute cache, so repeatedly navigating onto this page is cheap. The
  // Refresh button forces a fresh fetch.
  useEffect(() => {
    refreshConnectors();
  }, [refreshConnectors]);

  async function handleRefresh() {
    setBusy(true);
    try { await refreshConnectors({ force: true }); } finally { setBusy(false); }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-[var(--font-display)] text-xl font-semibold">Plugins</h1>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={busy}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 disabled:opacity-50"
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
          {busy ? 'Checking…' : 'Refresh'}
        </button>
      </div>
      <p className={`text-sm text-[var(--color-text-muted)] ${connectorsLastFetchedAt > 0 ? 'mb-1' : 'mb-6'}`}>
        Install integrations to give agents new tools — no core changes required. Connections for
        Composio-backed tools (like Gmail) are managed in your Composio dashboard, not here.
      </p>
      {connectorsLastFetchedAt > 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)] mb-6">
          Status last checked {new Date(connectorsLastFetchedAt).toLocaleTimeString()} · cached for 5 min
        </p>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ComposioCard icon={Mail} name="Gmail" desc="Read and send email on your behalf." toolPrefix="gmail" connectedKey="gmailConnected" />
        <ComposioCard icon={MessageSquare} name="Reddit" desc="Post replies to threads the Sales Agent finds." toolPrefix="reddit" connectedKey="redditConnected" />
        <ComposioCard
          icon={MessageCircle}
          name="WhatsApp"
          desc="Send/receive messages via Twilio Sandbox (no business verification needed)."
          toolPrefix="whatsapp"
          connectedKey="whatsappConnected"
          viaLabel="via Twilio"
          manageUrl="https://console.twilio.com"
          manageLabel="Set up on Twilio"
        />
        <ComposioCard icon={GitBranch} name="GitHub" desc="Create repos, commit files, and open pull requests." toolPrefix="github" connectedKey="githubConnected" />
        <ComposioCard
          icon={Calendar}
          name="Google Calendar"
          desc="Check availability and book calls with reminders."
          toolPrefix="googlecalendar"
          connectedKey="googlecalendarConnected"
        />
        <ComposioCard
          icon={MessageCircle}
          name="Telegram"
          desc="Draft and send replies to incoming Telegram messages."
          toolPrefix="telegram"
          connectedKey="telegramConnected"
          viaLabel="via Bot API"
          manageUrl="https://t.me/BotFather"
          manageLabel="Get a bot token from @BotFather"
        />
        {CATALOG.map(({ name, icon: Icon, desc }) => {
          const isInstalled = installed.has(name.toLowerCase());
          return (
            <div key={name} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-[var(--color-surface-2)] flex items-center justify-center">
                  <Icon size={16} className="text-[var(--color-text-muted)]" />
                </div>
                <div className="font-[var(--font-display)] font-semibold text-sm">{name}</div>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] flex-1">{desc}</p>
              <button
                disabled={isInstalled}
                className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
                  isInstalled
                    ? 'border-[var(--color-success)]/30 text-[var(--color-success)] cursor-default'
                    : 'border-[var(--color-accent)]/40 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10'
                }`}
              >
                {isInstalled ? 'Installed' : 'Install'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}